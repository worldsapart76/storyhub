"""Calibre Content Server REST client.

All reads and writes to the Calibre library go through this module — a CLI->REST
port of FFF's orchestrator/sync/calibre.py. There is NO calibredb here (CLAUDE.md
hard rule); every operation is an HTTP call to the Content Server, digest-authed
as the write-enabled ``storyhub`` account (see the calibre-rest-write-auth
memory for the verified contract).

Custom column names keep their ``#`` prefix end-to-end — the REST API returns
them that way natively (``user_metadata['#col']['#value#']``) and accepts them
that way in set-fields changes. FFF's old ``*`` -> ``#`` normalization is gone.

VERIFICATION STATUS (2026-06-14):
  VERIFIED against the live server (7,344-book library):
    - add-book, set-fields, ajax single-book read, delete-books (the four
      endpoints in the calibre-rest-write-auth memory);
    - bulk enumeration via ``/ajax/search`` (key ``book_ids``) + ``/ajax/books``;
    - the add-book *duplicate* response shape (add_duplicates=n): NO ``book_id``
      key, a ``duplicates: [{title, authors}]`` list, and an ``id`` that is the
      hex *job* id, not a book id. The existing book's id is NOT returned, so
      the caller must resolve it by searching.

  StoryHub passes the AO3 work id (known from the queue item) into add_book so
  duplicate resolution searches ``#ao3_work_id:{id}`` directly. FFF parsed the
  work id out of the epub filename — that does NOT work here because R2-staged
  epubs are named ``{queue_item_id}.epub``; filename parsing survives only as a
  last-resort fallback for manually-named FanFicFare files.
"""

from __future__ import annotations

import logging
import re
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx

from .config import Settings

log = logging.getLogger("storyhub_worker")

# Custom columns this project reads/writes. Kept for reference + so fetch_library
# callers know what to expect; REST returns whatever the library defines.
CUSTOM_COLUMNS = (
    "#ao3_work_id",
    "#collection",
    "#primaryship",
    "#wordcount",
    "#readstatus",
    "#shortsummary",
    "#date_read",
    "#all_fandoms",
    "#all_relationships",
    "#all_characters",
    "#maturity",
)

# Max book ids per /ajax/books request — keeps the query string well under any
# practical URL-length limit on a ~6,700-book library.
_BOOKS_BATCH = 250


class CalibreError(RuntimeError):
    """Raised when the Content Server returns an error or an unexpected shape."""


class CalibreClient:
    """Thin httpx wrapper over the Content Server REST API.

    One long-lived client per worker run, mirroring RailwayClient. Digest auth
    is attached to every request; with "Require username and password" enabled
    on the server, reads need it too.
    """

    def __init__(self, settings: Settings) -> None:
        self._library = settings.calibre_library_id
        self._client = httpx.Client(
            base_url=settings.calibre_url.rstrip("/"),
            auth=httpx.DigestAuth(
                settings.calibre_username, settings.calibre_password
            ),
            timeout=settings.calibre_timeout_seconds,
        )

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "CalibreClient":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    # -- reads --------------------------------------------------------------

    def fetch_library(self) -> list[dict[str, Any]]:
        """Return every book in the library as a list of flattened dicts.

        Each dict has: id, title, authors, tags, comments, series,
        series_index, plus every custom column keyed by its ``#name`` (value at
        the column's ``#value#``). Mirrors FFF's fetch_library() output shape so
        the lifted normalize code consumes it unchanged.

        Enumeration: ``/ajax/search`` for all ids, then ``/ajax/books`` in
        batches. (NOT YET VERIFIED against the live server — see module header.)
        """
        ids = self._all_book_ids()
        books: list[dict[str, Any]] = []
        for start in range(0, len(ids), _BOOKS_BATCH):
            batch = ids[start : start + _BOOKS_BATCH]
            id_param = ",".join(str(i) for i in batch)
            raw = self._get_json(f"/ajax/books/{self._library}", params={"ids": id_param})
            for book_id in batch:
                entry = raw.get(str(book_id))
                if entry is None:
                    # Book vanished between search and fetch — log, don't drop
                    # silently (FFF "no silent caps").
                    log.warning("calibre: book id %s missing from /ajax/books batch", book_id)
                    continue
                books.append(_flatten_book(book_id, entry))
        return books

    def fetch_book(self, calibre_id: int) -> dict[str, Any]:
        """Return one book as a flattened dict (VERIFIED read path)."""
        raw = self._get_json(f"/ajax/book/{calibre_id}/{self._library}")
        return _flatten_book(calibre_id, raw)

    def fetch_existing_ship_values(self) -> list[str]:
        """All distinct non-empty #primaryship values in the library, sorted.

        Feeds ship normalization (chunk 5) so a new import can snap to an
        existing canonical ship spelling instead of creating a near-duplicate.
        """
        seen: set[str] = set()
        for book in self.fetch_library():
            val = (book.get("#primaryship") or "").strip()
            if val:
                seen.add(val)
        return sorted(seen)

    def search_ids(self, query: str) -> list[int]:
        """Return calibre ids matching a Calibre search expression."""
        data = self._get_json(
            f"/ajax/search/{self._library}",
            params={"query": query, "num": 0x7FFFFFFF},
        )
        return [int(i) for i in data.get("book_ids", [])]

    # -- writes -------------------------------------------------------------

    def add_book(
        self,
        epub_path: Path,
        *,
        ao3_work_id: str | int | None = None,
        title: str | None = None,
        add_duplicates: bool = False,
    ) -> tuple[int, bool]:
        """Add an epub to the library.

        Returns ``(calibre_id, is_fresh)``. ``is_fresh`` is True when the server
        created a new entry, False when the epub was a duplicate and we resolved
        the existing id. Callers use is_fresh to decide whether to write
        ``#readstatus`` — existing books may already have a deliberate status
        that must not be overwritten (CLAUDE.md hard rule).

        On a duplicate the server returns no book id (see module header), so the
        caller should pass the ``ao3_work_id`` (and ideally ``title``) from the
        queue item; resolution searches ``#ao3_work_id`` then title, falling back
        to filename parsing only for manually-named FanFicFare files.
        """
        epub_path = Path(epub_path)
        job_id = uuid.uuid4().hex
        dup_flag = "y" if add_duplicates else "n"
        filename = quote(epub_path.name, safe="")
        url = f"/cdb/add-book/{job_id}/{dup_flag}/{filename}/{self._library}"
        data = self._post_json(url, content=epub_path.read_bytes())

        book_id = data.get("book_id")
        if book_id and not data.get("duplicates"):
            return int(book_id), True

        # Duplicate (or an add that returned no fresh id). Resolve the existing
        # book so the import can still attach metadata to it.
        existing = self._resolve_existing(ao3_work_id, title, epub_path)
        if existing is not None:
            return existing, False
        raise CalibreError(
            f"add-book returned no usable book_id and the existing book could "
            f"not be located (ao3_work_id={ao3_work_id!r}, title={title!r}, "
            f"file={epub_path.name!r}); raw response: {data!r}"
        )

    def set_fields(self, calibre_id: int, changes: dict[str, Any]) -> dict[str, Any]:
        """Write one or more fields for a book (VERIFIED write path).

        ``changes`` maps field name -> value. Custom columns keep their ``#``
        prefix. Multi-value columns take a list; datetimes take ISO8601 strings
        (use noon-UTC for #date_read per docs/data-model.md §6.1).
        """
        return self._post_json(
            f"/cdb/set-fields/{calibre_id}/{self._library}",
            json={"changes": changes, "loaded_book_ids": []},
        )

    def delete_book(self, calibre_id: int) -> None:
        """Remove a single book by id (VERIFIED write path)."""
        self.delete_books([calibre_id])

    def delete_books(self, calibre_ids: list[int]) -> None:
        ids = ",".join(str(i) for i in calibre_ids)
        self._post_json(f"/cdb/delete-books/{ids}/{self._library}", json=list(calibre_ids))

    # -- internals ----------------------------------------------------------

    def _all_book_ids(self) -> list[int]:
        """Every id in the library (empty query matches all)."""
        return self.search_ids("")

    def _resolve_existing(
        self,
        ao3_work_id: str | int | None,
        title: str | None,
        epub_path: Path,
    ) -> int | None:
        """Find the existing book id for a rejected duplicate.

        Order of reliability for StoryHub: the queue item's AO3 work id, then
        its exact title, then (only for manually-named FanFicFare files) the
        epub filename. R2-staged epubs are named by queue_item_id, so the
        filename step never fires for them — that's why work_id is passed in.
        """
        if ao3_work_id:
            ids = self.search_ids(f"#ao3_work_id:{ao3_work_id}")
            if ids:
                return ids[0]
        if title:
            ids = self.search_ids(f'title:="{title}"')
            if ids:
                return ids[0]
        return self._find_id_from_epub_filename(epub_path)

    def _find_id_from_epub_filename(self, epub_path: Path) -> int | None:
        """Locate an existing book matching an epub, by #ao3_work_id then title.

        Ported from FFF: handles both FanFicFare naming (``title-ao3_NNNNNN``)
        and manually named files. The title fallback covers the case where a
        prior add landed but the metadata write never ran, leaving
        ``#ao3_work_id`` unset.
        """
        stem = epub_path.stem  # e.g. "Trust Fall-ao3_67301515"
        m = re.search(r"ao3_(\d+)", stem)
        if m:
            ids = self.search_ids(f"#ao3_work_id:{m.group(1)}")
            if ids:
                return ids[0]
            title = stem[: m.start()].rstrip("- ")
        else:
            title = stem.replace("_", " ").strip()

        if title:
            ids = self.search_ids(f'title:="{title}"')
            if ids:
                return ids[0]
        return None

    def _get_json(self, url: str, params: dict[str, Any] | None = None) -> Any:
        resp = self._client.get(url, params=params)
        return _json_or_raise(resp, url)

    def _post_json(
        self,
        url: str,
        *,
        json: Any = None,
        content: bytes | None = None,
    ) -> Any:
        resp = self._client.post(url, json=json, content=content)
        return _json_or_raise(resp, url)


# ---------------------------------------------------------------------------
# Module helpers
# ---------------------------------------------------------------------------

def _json_or_raise(resp: httpx.Response, url: str) -> Any:
    """Return parsed JSON, raising CalibreError with the server's body on error.

    The Content Server returns useful plain-text errors (e.g. the 403
    "Anonymous users are not allowed to make changes" or a 404 "Argument of
    incorrect type" on a malformed URL); surface them rather than a bare status.
    """
    if resp.status_code >= 400:
        raise CalibreError(f"{resp.status_code} from {url}: {resp.text[:500]}")
    try:
        return resp.json()
    except ValueError as exc:
        raise CalibreError(f"non-JSON response from {url}: {resp.text[:200]}") from exc


def _flatten_book(calibre_id: int, raw: dict[str, Any]) -> dict[str, Any]:
    """Flatten an ajax book-metadata dict into FFF's fetch_library() shape.

    Custom columns come back nested under ``user_metadata[name]['#value#']``;
    lift each to a top-level ``#name`` key so callers index ``book['#readstatus']``
    directly, matching the old calibredb-list output.
    """
    book: dict[str, Any] = {
        "id": int(calibre_id),
        "title": raw.get("title"),
        "authors": raw.get("authors") or [],
        "tags": raw.get("tags") or [],
        "comments": raw.get("comments"),
        "series": raw.get("series"),
        "series_index": raw.get("series_index"),
    }
    for name, meta in (raw.get("user_metadata") or {}).items():
        # name already includes the '#'; value lives at '#value#'.
        book[name] = meta.get("#value#") if isinstance(meta, dict) else None
    return book
