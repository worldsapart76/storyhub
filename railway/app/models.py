"""Pydantic v2 models — request/response shapes for the /api surface.

These mirror docs/data-model.md §6.3. The worker imports the same models
(shared schema, no cross-language drift — the FastAPI rationale in
docs/components/railway-service.md).
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from uuid import UUID

from pydantic import BaseModel, Field


# --- Enums -------------------------------------------------------------------

class QueueStatus(str, Enum):
    pending = "pending"
    fetching = "fetching"
    importing = "importing"
    reviewing = "reviewing"
    done = "done"
    failed = "failed"


class ReadStatus(str, Enum):
    unread = "Unread"
    priority = "Priority"
    read = "Read"
    favorite = "Favorite"
    dnf = "DNF"


class AO3ActionType(str, Enum):
    bookmark = "bookmark"
    mark_read = "mark_read"


class AO3ActionStatus(str, Enum):
    pending = "pending"
    done = "done"


# --- queue_items -------------------------------------------------------------

class QueueItemCreate(BaseModel):
    work_id: str
    metadata_json: dict | None = None
    epub_r2_path: str | None = None
    source: str | None = None


class QueueItemAck(BaseModel):
    """Worker acks a drained item. Phase 1 worker no-ops -> done."""
    status: QueueStatus = QueueStatus.done
    calibre_id_assigned: int | None = None
    review_payload: dict | None = None
    error_message: str | None = None


class QueueItem(BaseModel):
    id: UUID
    work_id: str
    status: QueueStatus
    metadata_json: dict | None = None
    epub_r2_path: str | None = None
    source: str | None = None
    calibre_id_assigned: int | None = None
    review_payload: dict | None = None
    error_message: str | None = None
    created_at: datetime
    updated_at: datetime


# --- status_updates ----------------------------------------------------------

class StatusUpdateCreate(BaseModel):
    new_status: ReadStatus
    work_id: str | None = None
    calibre_id: int | None = None
    old_status: str | None = None
    source: str | None = None


class StatusUpdate(BaseModel):
    id: UUID
    work_id: str | None = None
    calibre_id: int | None = None
    new_status: ReadStatus
    old_status: str | None = None
    source: str | None = None
    created_at: datetime
    applied_at: datetime | None = None


# --- ao3_actions -------------------------------------------------------------

class AO3ActionCreate(BaseModel):
    work_id: str
    action: AO3ActionType
    status_update_id: UUID | None = None


class AO3Action(BaseModel):
    id: UUID
    work_id: str
    action: AO3ActionType
    status: AO3ActionStatus
    status_update_id: UUID | None = None
    created_at: datetime
    completed_at: datetime | None = None


# --- snapshot_versions -------------------------------------------------------

class SnapshotBump(BaseModel):
    r2_path: str
    book_count: int | None = None


class SnapshotVersion(BaseModel):
    version: int
    r2_path: str
    book_count: int | None = None
    created_at: datetime


# --- worker_heartbeats -------------------------------------------------------

class HeartbeatCreate(BaseModel):
    worker_id: str
    recent_log_lines: list[str] | None = None


class WorkerStatus(BaseModel):
    worker_id: str
    last_seen_at: datetime
    alive: bool
    recent_log_lines: list[str] | None = None
