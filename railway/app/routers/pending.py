"""/api/pending — the unified pending-changes queue (pending-queue redesign,
supersedes the §12.2 auto-drain + optimistic writes).

One row per user action from either surface. NOTHING is applied on creation — the
item carries two independent side-states (AO3 / library), each `pending` until the
user explicitly Applies on that surface:
  - PWA "Pending" page  -> POST /apply-library  (writes Postgres + rebuilds snapshot)
  - AO3 drawer          -> performs the AO3 side-effect, then POST /{id}/ack-ao3

The list is self-describing (title/author snapshotted at queue time so captures —
not yet in `works` — still render). Creating an action supersedes an existing
fully-pending item for the same work on the same axis, so the queue stays clean.
"""

from __future__ import annotations

import hashlib
import re
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from .. import commit, r2, snapshot_builder
from ..db import get_conn
from ..models import (
    CaptureRequest,
    CaptureRequestResult,
    NormalizationProposals,
    PendingAction,
    PendingChange,
    PendingCreate,
    PendingSide,
    RawCapture,
    ReviewDecision,
)
from ..normalize import normalize_capture

# AO3 work id from a /works/<id> URL (ignores /chapters/..., query strings, the
# host) or a bare numeric id. Shared text from a phone may wrap the URL in a title.
_WORK_ID_RE = re.compile(r"/works/(\d+)")


def _resolve_work_id(req: CaptureRequest) -> int:
    if req.work_id is not None:
        return req.work_id
    if req.url:
        m = _WORK_ID_RE.search(req.url)
        if m:
            return int(m.group(1))
        bare = req.url.strip()
        if bare.isdigit():
            return int(bare)
    raise HTTPException(
        status.HTTP_422_UNPROCESSABLE_ENTITY,
        "Could not find an AO3 work id in the supplied URL",
    )


class _SkipNotReady(Exception):
    """A library-pending item that isn't ready to commit yet (capture awaiting epub
    or primary review) — skipped by apply-library, not failed."""

router = APIRouter(prefix="/pending", tags=["pending"])

_COLS = (
    "id, work_id, action, title, author, payload, staging_key, "
    "ao3_state, library_state, origin, error, created_at, updated_at"
)

# Actions that touch the same field collapse onto one queue slot per work, so two
# contradictory clicks (mark_read then mark_unread) don't both linger.
_AXIS = {
    PendingAction.capture: "capture",
    PendingAction.mark_read: "status",
    PendingAction.mark_unread: "status",
    PendingAction.mark_dnf: "status",
    PendingAction.favorite: "favorite",
    PendingAction.unfavorite: "favorite",
}
_AXIS_ACTIONS = {
    axis: [a.value for a, x in _AXIS.items() if x == axis]
    for axis in set(_AXIS.values())
}


async def _load(conn: asyncpg.Connection, pid: UUID) -> PendingChange:
    row = await conn.fetchrow(f"SELECT {_COLS} FROM pending_changes WHERE id = $1", pid)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pending item not found")
    return PendingChange(**dict(row))


@router.post("", response_model=PendingChange, status_code=status.HTTP_201_CREATED)
async def create_pending(
    body: PendingCreate, conn: asyncpg.Connection = Depends(get_conn)
) -> PendingChange:
    # Snapshot display info from `works` if the caller didn't supply it (captures
    # supply their own, since the work doesn't exist yet).
    title, author = body.title, body.author
    if title is None:
        w = await conn.fetchrow("SELECT title FROM works WHERE work_id = $1", body.work_id)
        title = w["title"] if w else None
    if author is None:
        a = await conn.fetchrow(
            "SELECT au.name FROM work_authors wa JOIN authors au ON au.author_id = wa.author_id "
            "WHERE wa.work_id = $1 ORDER BY wa.position LIMIT 1",
            body.work_id,
        )
        author = a["name"] if a else None

    # Supersede a fully-pending item on the same axis for this work.
    siblings = _AXIS_ACTIONS[_AXIS[body.action]]
    await conn.execute(
        "DELETE FROM pending_changes WHERE work_id = $1 AND action = ANY($2::text[]) "
        "AND ao3_state = 'pending' AND library_state = 'pending'",
        body.work_id, siblings,
    )

    row = await conn.fetchrow(
        f"INSERT INTO pending_changes "
        f"(work_id, action, title, author, payload, staging_key, origin) "
        f"VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING {_COLS}",
        body.work_id, body.action.value, title, author,
        body.payload, body.staging_key, body.origin.value,
    )
    return PendingChange(**dict(row))


@router.post("/capture", response_model=PendingChange, status_code=status.HTTP_201_CREATED)
async def create_capture(
    payload: RawCapture, conn: asyncpg.Connection = Depends(get_conn)
) -> PendingChange:
    """Queue a NEW work for capture (Mark for Later on a not-in-library work). The
    server normalizes + creates the raw tag rows now (so Review Queue can pick
    primaries), but the work is NOT committed until Apply to Library. The epub is
    uploaded next via POST /{id}/epub and held in R2 until apply (or cancel)."""
    proposals = normalize_capture(payload)
    for prop in proposals.tags:
        tag = await conn.fetchrow(
            "INSERT INTO tags (name, kind) VALUES ($1,$2) "
            "ON CONFLICT (name, kind) DO UPDATE SET updated_at = now() RETURNING tag_id",
            prop.name, prop.kind.value,
        )
        prop.tag_id = tag["tag_id"]
    proposals.approved = proposals.auto  # unambiguous = ready; ambiguous needs review

    # Supersede a prior uncommitted capture of the same work (delete its held epub).
    # Match on library_state only — a stub whose AO3 side was already applied
    # (ao3_state='done') must still be replaced, not duplicated.
    prev = await conn.fetch(
        "SELECT id, staging_key FROM pending_changes WHERE work_id=$1 AND action='capture' "
        "AND library_state='pending'",
        payload.work_id,
    )
    for p in prev:
        if p["staging_key"] and r2.is_configured():
            try:
                await r2.delete(p["staging_key"])
            except Exception:  # noqa: BLE001
                pass
    if prev:
        await conn.execute("DELETE FROM pending_changes WHERE id = ANY($1::uuid[])",
                           [p["id"] for p in prev])

    row = await conn.fetchrow(
        f"INSERT INTO pending_changes (work_id, action, title, author, payload, origin) "
        f"VALUES ($1,'capture',$2,$3,$4,'ao3') RETURNING {_COLS}",
        payload.work_id, payload.title,
        payload.authors[0] if payload.authors else None,
        {"raw_metadata": payload.model_dump(mode="json"),
         "proposals": proposals.model_dump(mode="json")},
    )
    return PendingChange(**dict(row))


@router.post("/request-capture", response_model=CaptureRequestResult,
             status_code=status.HTTP_201_CREATED)
async def request_capture(
    req: CaptureRequest, conn: asyncpg.Connection = Depends(get_conn)
) -> CaptureRequestResult:
    """Queue a work for capture from the PWA (paste-a-URL / share target). Leaves a
    lightweight STUB only — the PWA can't scrape AO3 or fetch the epub, so the PC
    drains the stub later (GET /fetch-queue) and its full capture supersedes it.
    Idempotent: a work already queued or already in the library is reported, not
    duplicated."""
    work_id = _resolve_work_id(req)

    if await conn.fetchval("SELECT 1 FROM works WHERE work_id = $1", work_id):
        return CaptureRequestResult(status="already_in_library", work_id=work_id)

    # Dedupe on the library side only (not both sides): a capture whose AO3 side was
    # already applied but isn't committed yet is still the same pending add.
    existing = await conn.fetchrow(
        f"SELECT {_COLS} FROM pending_changes WHERE work_id = $1 AND action = 'capture' "
        f"AND library_state = 'pending'",
        work_id,
    )
    if existing is not None:
        return CaptureRequestResult(
            status="already_queued", work_id=work_id,
            pending=PendingChange(**dict(existing)),
        )

    row = await conn.fetchrow(
        f"INSERT INTO pending_changes (work_id, action, payload, origin) "
        f"VALUES ($1, 'capture', $2, 'pwa') RETURNING {_COLS}",
        work_id, {"needs_fetch": True, "source_url": req.url},
    )
    return CaptureRequestResult(
        status="queued", work_id=work_id, pending=PendingChange(**dict(row)),
    )


@router.get("/fetch-queue", response_model=list[PendingChange])
async def fetch_queue(conn: asyncpg.Connection = Depends(get_conn)) -> list[PendingChange]:
    """Captures still awaiting a PC epub fetch — both URL/share stubs and any capture
    whose epub fetch previously failed (`staging_key IS NULL`). Keying on the missing
    epub (not the needs_fetch flag) makes the drawer's Fetch self-healing: a capture
    that died before its epub uploaded gets retried instead of stranded. The AO3
    drawer pulls this and runs its content-script capture on each work_id (which
    supersedes the row with the completed capture)."""
    rows = await conn.fetch(
        f"SELECT {_COLS} FROM pending_changes "
        f"WHERE action = 'capture' AND library_state = 'pending' "
        f"AND staging_key IS NULL ORDER BY created_at"
    )
    return [PendingChange(**dict(r)) for r in rows]


@router.post("/{pending_id}/epub", response_model=PendingChange)
async def upload_capture_epub(
    pending_id: UUID, request: Request, conn: asyncpg.Connection = Depends(get_conn)
) -> PendingChange:
    """Receive the held epub bytes for a queued capture (fetched in the AO3 page
    context — the only place AO3's Cloudflare allows it) and stage them to R2."""
    row = await conn.fetchrow("SELECT payload FROM pending_changes WHERE id=$1", pending_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pending item not found")
    if not r2.is_configured():
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "R2 not configured")
    data = await request.body()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Empty epub body")
    staging_key = r2.staging_key(str(pending_id))
    await r2.put_bytes(staging_key, data, "application/epub+zip")
    payload = row["payload"] or {}
    proposals = payload.get("proposals") or {}
    proposals["epub_staged"] = True
    proposals["epub_hash"] = hashlib.sha256(data).hexdigest()
    payload["proposals"] = proposals
    upd = await conn.fetchrow(
        f"UPDATE pending_changes SET staging_key=$2, payload=$3, updated_at=now() "
        f"WHERE id=$1 RETURNING {_COLS}",
        pending_id, staging_key, payload,
    )
    return PendingChange(**dict(upd))


@router.post("/{pending_id}/review", response_model=PendingChange)
async def review_capture(
    pending_id: UUID, decision: ReviewDecision, conn: asyncpg.Connection = Depends(get_conn)
) -> PendingChange:
    """Per-work Review Queue confirm for an ambiguous capture — set which of the
    work's own tags carry the primary ship / collection flags, marking the capture
    ready to apply. Never touches tag grouping/categories (hard rule)."""
    row = await conn.fetchrow("SELECT payload FROM pending_changes WHERE id=$1", pending_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pending item not found")
    payload = row["payload"] or {}
    proposals = NormalizationProposals(**(payload.get("proposals") or {}))
    valid = {p.tag_id for p in proposals.tags}
    for tag_id in (decision.primary_ship_tag_id, decision.primary_collection_tag_id):
        if tag_id is not None and tag_id not in valid:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                               f"tag_id {tag_id} is not one of this work's tags")
    for prop in proposals.tags:
        prop.is_primary_ship = prop.tag_id == decision.primary_ship_tag_id
        prop.is_primary_collection = prop.tag_id == decision.primary_collection_tag_id
    proposals.primary_ship_name = next((p.name for p in proposals.tags if p.is_primary_ship), None)
    proposals.primary_collection_name = next(
        (p.name for p in proposals.tags if p.is_primary_collection), None)
    proposals.approved = True
    payload["proposals"] = proposals.model_dump(mode="json")
    upd = await conn.fetchrow(
        f"UPDATE pending_changes SET payload=$2, updated_at=now() WHERE id=$1 RETURNING {_COLS}",
        pending_id, payload,
    )
    return PendingChange(**dict(upd))


@router.get("", response_model=list[PendingChange])
async def list_pending(
    side: str | None = Query(None, pattern="^(ao3|library)$"),
    conn: asyncpg.Connection = Depends(get_conn),
) -> list[PendingChange]:
    """Open items (at least one side still pending), newest first. `side=ao3`
    narrows to what the AO3 drawer must apply; `side=library` to the PWA's."""
    if side == "ao3":
        where = "ao3_state = 'pending'"
    elif side == "library":
        where = "library_state = 'pending'"
    else:
        where = "(ao3_state = 'pending' OR library_state = 'pending')"
    rows = await conn.fetch(
        f"SELECT {_COLS} FROM pending_changes WHERE {where} ORDER BY created_at DESC"
    )
    return [PendingChange(**dict(r)) for r in rows]


@router.delete("/{pending_id}", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_pending(
    pending_id: UUID, conn: asyncpg.Connection = Depends(get_conn)
):
    """Cancel a queued item. Deletes the row and any held epub. Does NOT reverse a
    side that was already applied (no AO3 un-mark / library revert) — reverse-on-cancel
    was deliberately dropped 2026-06-18 (rarely needed, not worth the risk). Cancelling
    before Apply is fully clean; cancelling after only stops the not-yet-applied side."""
    row = await conn.fetchrow(
        "SELECT staging_key FROM pending_changes WHERE id = $1", pending_id
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pending item not found")
    if row["staging_key"] and r2.is_configured():
        try:
            await r2.delete(row["staging_key"])
        except Exception:  # noqa: BLE001 - a leftover staging object is harmless
            pass
    await conn.execute("DELETE FROM pending_changes WHERE id = $1", pending_id)


async def _apply_library_one(conn: asyncpg.Connection, row) -> None:
    action, wid = row["action"], row["work_id"]
    if action == PendingAction.mark_read.value:
        await conn.execute(
            "UPDATE works SET read_status='Read', date_read=now(), updated_at=now() "
            "WHERE work_id=$1", wid)
    elif action == PendingAction.mark_unread.value:
        await conn.execute(
            "UPDATE works SET read_status='Unread', updated_at=now() WHERE work_id=$1", wid)
    elif action == PendingAction.mark_dnf.value:
        # DNF still stamps date_read: reading far enough to bail IS reading it on
        # that date (analytics keys "completed = no longer Unread" off date_read).
        await conn.execute(
            "UPDATE works SET read_status='DNF', date_read=now(), updated_at=now() "
            "WHERE work_id=$1", wid)
    elif action == PendingAction.favorite.value:
        await conn.execute(
            "UPDATE works SET is_favorite=true, read_status='Read', date_read=now(), "
            "updated_at=now() WHERE work_id=$1", wid)
    elif action == PendingAction.unfavorite.value:
        await conn.execute(
            "UPDATE works SET is_favorite=false, updated_at=now() WHERE work_id=$1", wid)
    elif action == PendingAction.capture.value:
        payload = row["payload"] or {}
        proposals = NormalizationProposals(**(payload.get("proposals") or {}))
        if not proposals.epub_staged:
            raise _SkipNotReady("epub not uploaded yet")
        if not (proposals.auto or proposals.approved):
            raise _SkipNotReady("awaiting primary review")
        capture_meta = RawCapture(**(payload.get("raw_metadata") or {}))
        await commit.upsert_work(conn, wid, capture_meta, proposals, row["staging_key"])


@router.post("/apply-library")
async def apply_library(conn: asyncpg.Connection = Depends(get_conn)) -> dict:
    """Commit every library-pending item to Postgres, then rebuild the snapshot
    once. Per-item failures are recorded on the row, not fatal to the batch."""
    rows = await conn.fetch(
        f"SELECT {_COLS} FROM pending_changes WHERE library_state='pending' "
        f"ORDER BY created_at"
    )
    applied, failed, skipped = 0, 0, 0
    for row in rows:
        try:
            async with conn.transaction():
                await _apply_library_one(conn, row)
                await conn.execute(
                    "UPDATE pending_changes SET library_state='done', error=NULL, "
                    "updated_at=now() WHERE id=$1", row["id"])
            applied += 1
        except _SkipNotReady:
            skipped += 1  # capture awaiting epub / review — left pending, not an error
        except Exception as exc:  # noqa: BLE001
            await conn.execute(
                "UPDATE pending_changes SET error=$2, updated_at=now() WHERE id=$1",
                row["id"], str(exc))
            failed += 1

    result: dict = {"applied": applied, "failed": failed, "skipped": skipped}
    if applied and r2.is_configured():
        snap = await snapshot_builder.build_and_upload(conn)
        result["snapshot_version"] = snap.get("version")
    return result


@router.post("/{pending_id}/ack-ao3", response_model=PendingChange)
async def ack_ao3(
    pending_id: UUID,
    result: PendingSide = Query(PendingSide.done),
    error: str | None = Query(None),
    conn: asyncpg.Connection = Depends(get_conn),
) -> PendingChange:
    """The extension marks an item's AO3 side done (or leaves it pending with an
    error) after performing the side-effect from the AO3 drawer."""
    row = await conn.fetchrow(
        "UPDATE pending_changes SET ao3_state=$2, error=$3, updated_at=now() "
        f"WHERE id=$1 RETURNING {_COLS}",
        pending_id, result.value, error,
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Pending item not found")
    return PendingChange(**dict(row))
