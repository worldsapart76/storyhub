"""Phase A+B smoke test — exercises the live hub end-to-end (stdlib only).

Usage (PowerShell):
    $env:AUTH_TOKEN="..."; $env:HUB_URL="https://ffstoryhub.up.railway.app"
    railway/.venv/Scripts/python.exe railway/smoke_test.py

Covers: health, tag create/get, work upsert/get/patch, the auto-commit import
path (capture -> upload -> committed), and the review path (ambiguous capture ->
review primaries -> committed). Works with OR without R2 configured: if the
capture returns a presigned URL it PUTs a dummy epub so the commit's R2 copy
succeeds; otherwise it just marks the epub staged.

Leaves test rows (work_ids 999000001/2) behind — harmless; cleared by the next
schema reset. Exit code 0 = all passed.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

BASE = os.environ.get("HUB_URL", "https://ffstoryhub.up.railway.app").rstrip("/")
TOKEN = os.environ.get("AUTH_TOKEN")

_passed = 0
_failed = 0


def check(label: str, cond: bool, detail: str = "") -> None:
    global _passed, _failed
    if cond:
        _passed += 1
        print(f"  PASS  {label}")
    else:
        _failed += 1
        print(f"  FAIL  {label}  {detail}")


def req(method: str, path: str, body=None, auth: bool = True, raw_url: str | None = None):
    url = raw_url or f"{BASE}{path}"
    data = None
    headers = {}
    if body is not None and not raw_url:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    if raw_url and body is not None:  # presigned PUT of raw bytes
        data = body
        headers["Content-Type"] = "application/epub+zip"
    if auth and not raw_url:
        headers["Authorization"] = f"Bearer {TOKEN}"
    r = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r) as resp:
            payload = resp.read()
            return resp.status, (json.loads(payload) if payload else None)
    except urllib.error.HTTPError as e:
        payload = e.read()
        try:
            return e.code, json.loads(payload)
        except Exception:
            return e.code, payload.decode(errors="replace")


def upload_epub(resp) -> None:
    """PUT a dummy epub to the presigned URL if R2 is configured."""
    url = resp.get("presigned_put_url")
    if url:
        req("PUT", "", body=b"PK\x03\x04 dummy epub", raw_url=url)


def main() -> int:
    if not TOKEN:
        print("ERROR: set AUTH_TOKEN (and optionally HUB_URL)")
        return 2
    print(f"Hub: {BASE}\n")

    print("[health]")
    st, _ = req("GET", "/health", auth=False)
    check("GET /health -> 200", st == 200, f"got {st}")

    print("[auth]")
    st, _ = req("GET", "/api/works", auth=False)
    check("unauthenticated /api -> 401/403", st in (401, 403), f"got {st}")

    print("[tags]")
    st, tag = req("POST", "/api/tags", {"name": "Smoke Test Tag", "kind": "freeform"})
    check("POST /api/tags -> 201", st == 201, f"got {st}: {tag}")
    if st == 201:
        st2, got = req("GET", f"/api/tags/{tag['tag_id']}")
        check("GET tag echoes name", st2 == 200 and got["name"] == "Smoke Test Tag")

    print("[works upsert/get/patch]")
    wid = 999000001
    work = {"work_id": wid, "title": "Smoke Work", "rating": "Teen",
            "wordcount": 1000, "read_status": "Unread"}
    st, w = req("PUT", f"/api/works/{wid}", work)
    check("PUT /api/works -> 200", st == 200, f"got {st}: {w}")
    st, w = req("PATCH", f"/api/works/{wid}", {"is_favorite": True, "read_status": "Read"})
    check("PATCH favorite+read -> 200", st == 200 and w.get("is_favorite") is True)
    st, w = req("PATCH", f"/api/works/{wid}", {"read_status": "Unread"})
    check("PATCH read_status=Unread rejected (hard rule)", st == 422, f"got {st}")

    print("[import: auto-commit path]")
    cap = {"work_id": 999000002, "title": "Auto Imported",
           "fandoms": ["Test Fandom"], "relationships": ["Alice/Bob"],
           "characters": ["Alice"], "rating": "Mature",
           "wordcount": 5000, "authors": ["test_author"]}
    st, resp = req("POST", "/api/queue", cap)
    check("POST /api/queue -> 201", st == 201, f"got {st}: {resp}")
    if st == 201:
        check("auto path: needs_review false", resp["needs_review"] is False)
        qid = resp["queue_item"]["queue_item_id"]
        upload_epub(resp)
        st, item = req("POST", f"/api/queue/{qid}/uploaded", {"epub_hash": "deadbeef"})
        check("auto commit after upload", st == 200 and item["state"] == "committed",
              f"state={item.get('state')} err={item.get('error')}")
        st, w = req("GET", "/api/works/999000002")
        check("committed work is readable", st == 200 and w["title"] == "Auto Imported")

    print("[import: review path]")
    cap2 = {"work_id": 999000003, "title": "Needs Review",
            "fandoms": ["Fandom A", "Fandom B"],
            "relationships": ["Carol/Dave", "Eve/Frank"],
            "rating": "General", "authors": ["rev_author"]}
    st, resp = req("POST", "/api/queue", cap2)
    check("ambiguous capture -> needs_review true", st == 201 and resp["needs_review"] is True)
    if st == 201:
        qid = resp["queue_item"]["queue_item_id"]
        tags = resp["queue_item"]["proposals"]["tags"]
        ship = next(t["tag_id"] for t in tags if t["kind"] == "relationship")
        coll = next(t["tag_id"] for t in tags if t["kind"] == "fandom")
        upload_epub(resp)
        st, item = req("POST", f"/api/queue/{qid}/uploaded", {"epub_hash": "cafe"})
        check("not committed before review", item.get("state") == "needs_review",
              f"state={item.get('state')}")
        st, item = req("POST", f"/api/queue/{qid}/review",
                       {"primary_ship_tag_id": ship, "primary_collection_tag_id": coll})
        check("committed after review", st == 200 and item["state"] == "committed",
              f"state={item.get('state')} err={item.get('error')}")

    print("[list]")
    st, works = req("GET", "/api/works?limit=10")
    check("GET /api/works -> list", st == 200 and isinstance(works, list))

    print(f"\n{_passed} passed, {_failed} failed")
    return 0 if _failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
