"""Pydantic v2 models — request/response shapes for the /api surface.

Mirrors the redesign schema (docs/calibre-removal-redesign.md §6 + §12). The
worker imports the same models (shared schema, no cross-language drift).

Phase A provides read+write models for the core entities (works, tags, groups)
plus the reshaped operational models (queue, ao3_actions, snapshot, worker).
The heavy import/normalization pipeline (queue normalize/commit) is Phase B.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from uuid import UUID

from pydantic import BaseModel, Field


# --- Enums -------------------------------------------------------------------

class Source(str, Enum):
    ao3 = "ao3"
    pre_ao3 = "pre_ao3"
    other = "other"


class WorkType(str, Enum):
    fanfiction = "fanfiction"
    book = "book"


class Rating(str, Enum):
    explicit = "Explicit"
    mature = "Mature"
    teen = "Teen"
    general = "General"
    not_rated = "Not Rated"


class ReadStatus(str, Enum):
    unread = "Unread"
    read = "Read"
    dnf = "DNF"


class Availability(str, Enum):
    live = "live"
    deleted = "deleted"
    locked = "locked"
    na = "n/a"


class TagKind(str, Enum):
    fandom = "fandom"
    relationship = "relationship"
    character = "character"
    freeform = "freeform"
    warning = "warning"


class TagState(str, Enum):
    favorite = "favorite"
    normal = "normal"
    excluded = "excluded"


class GroupType(str, Enum):
    collection = "collection"
    property = "property"


class QueueSource(str, Enum):
    ao3 = "ao3"
    manual = "manual"
    bookmarklet = "bookmarklet"


class QueueState(str, Enum):
    pending = "pending"
    normalized = "normalized"
    auto_committed = "auto_committed"
    needs_review = "needs_review"
    committed = "committed"
    failed = "failed"


class AO3ActionType(str, Enum):
    mark_read = "mark_read"
    mark_for_later = "mark_for_later"   # AO3's "Mark for Later" = back to Unread (toggles off Read)
    bookmark = "bookmark"
    remove_bookmark = "remove_bookmark"


class AO3ActionStatus(str, Enum):
    pending = "pending"
    done = "done"
    failed = "failed"


# --- works -------------------------------------------------------------------

class WorkUpsert(BaseModel):
    """Create/replace a work. Used by migration (Phase D) and the commit
    pipeline (Phase B). work_id is the AO3 id (pos) / pre-AO3 local id (neg)."""
    work_id: int
    title: str
    source: Source = Source.ao3
    work_type: WorkType = WorkType.fanfiction
    source_url: str | None = None
    summary_html: str | None = None
    short_summary: str | None = None
    wordcount: int | None = None
    chapter_count: int | None = None
    is_complete: bool | None = None
    language: str | None = None
    series_name: str | None = None
    series_index: float | None = None
    rating: Rating | None = None
    read_status: ReadStatus = ReadStatus.unread
    is_favorite: bool = False
    pinned: bool = False
    personal_notes: str | None = None
    date_read: datetime | None = None
    date_added: datetime | None = None
    availability: Availability = Availability.live
    last_seen_on_ao3: datetime | None = None
    epub_r2_key: str | None = None
    epub_hash: str | None = None
    cover_r2_key: str | None = None


class WorkPatch(BaseModel):
    """Partial update — the optimistic status/favorite writes from the PWA
    (Phase F) and availability flips. read_status='Unread' is rejected at the
    router (hard rule: never write Unread)."""
    read_status: ReadStatus | None = None
    is_favorite: bool | None = None
    pinned: bool | None = None
    personal_notes: str | None = None
    date_read: datetime | None = None
    availability: Availability | None = None


class ReconcileFavoritesRequest(BaseModel):
    """The AO3-bookmarked work ids (scraped by the extension, the only client with an
    AO3 session). The server flips matching library works to is_favorite — see
    works.reconcile_favorites for the read-status/date semantics."""
    work_ids: list[int]


class Work(BaseModel):
    work_id: int
    source: Source
    work_type: WorkType
    source_url: str | None = None
    title: str
    summary_html: str | None = None
    short_summary: str | None = None
    wordcount: int | None = None
    chapter_count: int | None = None
    is_complete: bool | None = None
    language: str | None = None
    series_name: str | None = None
    series_index: float | None = None
    rating: Rating | None = None
    read_status: ReadStatus
    is_favorite: bool
    pinned: bool
    personal_notes: str | None = None
    date_read: datetime | None = None
    date_added: datetime | None = None
    availability: Availability
    last_seen_on_ao3: datetime | None = None
    epub_r2_key: str | None = None
    epub_hash: str | None = None
    cover_r2_key: str | None = None
    created_at: datetime
    updated_at: datetime


class WorkCollectionAdd(BaseModel):
    """Add a fandom tag edge to an existing work (curation: the real fandom was never
    on the work because the author filed only a ship-as-fandom, e.g. "Dramione -
    Fandom"). Optionally make it the primary collection in the same call."""
    tag_id: int
    set_primary: bool = False


# --- tags --------------------------------------------------------------------

class TagCreate(BaseModel):
    """Create (or upsert on name+kind) a raw tag. Normalization (Phase B) and
    migration (Phase D) create tags ungrouped/uncategorized — that never blocks
    import (§6.3.1)."""
    name: str
    kind: TagKind
    display_name: str | None = None
    category: str | None = None
    canonical_tag_id: int | None = None
    state: TagState = TagState.normal
    auto_classified: bool = False


class TagPatch(BaseModel):
    """Tag Management curation (Phase G): display alias, category, synonym
    canonical, state, kind. canonical_tag_id set => this tag is a synonym of that
    canonical (§6.3.1 refinement, [RESOLVED #1]). kind is editable because AO3
    authors mis-file tags (e.g. a ship typed on the character line) — changing it
    moves the tag to the right Browse box and clears now-invalid primary flags."""
    display_name: str | None = None
    category: str | None = None
    canonical_tag_id: int | None = None
    state: TagState | None = None
    auto_classified: bool | None = None
    kind: TagKind | None = None


class TagBulkPatch(BaseModel):
    """Apply one patch to many tags in a single request — bulk Tag-Management actions
    (Confirm / Favorite / Exclude / Set category / Synonym) over a large selection.
    The client must NOT fan out one PATCH per tag (thousands of concurrent fetches
    fail as 'Failed to fetch')."""
    tag_ids: list[int]
    patch: TagPatch


class TagStateByBrowse(BaseModel):
    """Set a tag's state from a Browse filter box, which knows the chip's display
    label + which category box it's in but not the tag_id. The hub resolves the
    live canonical tag (Browse favorites read live, not from the snapshot, so the
    resolution must be live too)."""
    name: str
    browse_category: str
    state: TagState


class Tag(BaseModel):
    tag_id: int
    name: str
    display_name: str | None = None
    kind: TagKind
    category: str | None = None
    canonical_tag_id: int | None = None
    state: TagState
    auto_classified: bool
    updated_at: datetime


# --- tag_groups (roll-ups only: collection | property) -----------------------

class GroupCreate(BaseModel):
    name: str
    group_type: GroupType
    canonical_tag_id: int | None = None
    member_tag_ids: list[int] = []


class GroupPatch(BaseModel):
    name: str | None = None
    canonical_tag_id: int | None = None


class TagGroup(BaseModel):
    group_id: int
    name: str
    group_type: GroupType
    canonical_tag_id: int | None = None
    parent_group_id: int | None = None
    updated_at: datetime
    member_tag_ids: list[int] = []


# --- categories (the freeform category SET + global lock; §12.6) --------------

class Category(BaseModel):
    id: int
    name: str
    display_order: int | None = None


class CategoryCreate(BaseModel):
    name: str


class CategoryRename(BaseModel):
    name: str


class CategoryReorder(BaseModel):
    ids: list[int]


class CategoryLock(BaseModel):
    locked: bool


class CategoryList(BaseModel):
    """The ordered category set plus the single global lock state (§12.6)."""
    categories: list[Category] = []
    locked: bool = False


# --- capture payload + normalization proposals (§12.1) -----------------------

class RawCapture(BaseModel):
    """The raw AO3 metadata the extension POSTs to /api/queue (§12.1). Lists are
    in AO3 order; the extension does no normalization."""
    work_id: int
    source: QueueSource = QueueSource.ao3
    source_url: str | None = None
    title: str
    summary_html: str | None = None
    fandoms: list[str] = []
    relationships: list[str] = []
    characters: list[str] = []
    warnings: list[str] = []
    freeform_tags: list[str] = []
    rating: str | None = None              # raw AO3 label; mapped server-side
    wordcount: int | None = None
    chapter_count: int | None = None
    is_complete: bool | None = None
    series_name: str | None = None
    series_index: float | None = None
    language: str | None = None
    authors: list[str] = []                # byline order
    epub_url: str | None = None            # AO3 download URL (stored for reference;
                                           # the extension content script fetches the
                                           # epub + POSTs bytes to /queue/{id}/epub)


class TagProposal(BaseModel):
    """One proposed tag row + its per-kind position and primary-role flags.
    tag_id is filled in by the queue handler once the tag row exists."""
    name: str
    kind: TagKind
    position: int
    tag_id: int | None = None
    is_primary_ship: bool = False
    is_primary_collection: bool = False


class NormalizationProposals(BaseModel):
    """Stored verbatim in queue_items.proposals. Carries the import decision and
    everything commit needs."""
    tags: list[TagProposal] = []
    primary_ship_name: str | None = None
    primary_collection_name: str | None = None
    rating: Rating | None = None
    auto: bool = False
    review_reason: str | None = None
    approved: bool = False                  # review-confirmed (auto items skip review)
    epub_staged: bool = False
    epub_hash: str | None = None


class ReviewDecision(BaseModel):
    """Per-work Review Queue confirm — primaries only (§12.1). tag_ids must be
    among the work's own tags; null clears the axis (gen / no collection)."""
    primary_ship_tag_id: int | None = None
    primary_collection_tag_id: int | None = None


class UploadedNotice(BaseModel):
    """Extension reports the staging epub is uploaded (with its content hash)."""
    epub_hash: str | None = None


# --- queue_items (reshaped §12.1) --------------------------------------------

class QueueItem(BaseModel):
    queue_item_id: UUID
    work_id: int
    source: QueueSource
    raw_metadata: dict | None = None
    staging_key: str | None = None
    state: QueueState
    proposals: dict | None = None
    error: str | None = None
    created_at: datetime
    updated_at: datetime


class QueueCreateResponse(BaseModel):
    """POST /api/queue response: the item plus the presigned URL the extension
    PUTs the epub to. needs_review false => auto-commits once the epub uploads."""
    queue_item: QueueItem
    presigned_put_url: str | None = None    # null if R2 not configured
    needs_review: bool


# --- ao3_actions (§12.2) -----------------------------------------------------

class AO3ActionCreate(BaseModel):
    work_id: int
    action: AO3ActionType
    params: dict | None = None


class AO3Action(BaseModel):
    id: UUID
    work_id: int
    action: AO3ActionType
    params: dict | None = None
    status: AO3ActionStatus
    created_at: datetime
    done_at: datetime | None = None


# --- snapshot_versions (§12.3) -----------------------------------------------

class SnapshotBump(BaseModel):
    r2_path: str
    work_count: int | None = None
    format_version: int = 1


class SnapshotVersion(BaseModel):
    version: int
    format_version: int
    r2_path: str
    work_count: int | None = None
    created_at: datetime


# --- worker_heartbeats (§12.4) -----------------------------------------------

class HeartbeatCreate(BaseModel):
    worker_id: str
    recent_log_lines: list[str] | None = None


class WorkerStatus(BaseModel):
    worker_id: str
    last_seen_at: datetime
    alive: bool
    recent_log_lines: list[str] | None = None


# --- pc_jobs (§12.4 — worker thin-agent job queue) ---------------------------

class PcJobType(str, Enum):
    x4_transfer = "x4_transfer"
    backup_pull = "backup_pull"


class PcJobStatus(str, Enum):
    pending = "pending"
    running = "running"
    done = "done"
    failed = "failed"


class PcJobCreate(BaseModel):
    job_type: PcJobType
    params: dict = Field(default_factory=dict)


class PcJobClaim(BaseModel):
    worker_id: str


class PcJobFinish(BaseModel):
    # Worker's terminal report. status is done | failed; log is the full run output.
    status: PcJobStatus
    log: str | None = None


class PcJobProgress(BaseModel):
    # Mid-run log update so the dashboard can show progress before the job finishes.
    log: str


class PcJob(BaseModel):
    id: UUID
    job_type: PcJobType
    params: dict
    status: PcJobStatus
    log: str | None = None
    worker_id: str | None = None
    created_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None


# --- reading_lists (§6.4) ----------------------------------------------------

class ReadingListCreate(BaseModel):
    name: str
    description: str | None = None
    color: str | None = None
    auto_pin: bool = False
    starred: bool = False


class ReadingListPatch(BaseModel):
    """Partial update. is_system/membership_rule are not user-editable here."""
    name: str | None = None
    description: str | None = None
    color: str | None = None
    cover_image_r2_key: str | None = None
    auto_pin: bool | None = None
    starred: bool | None = None
    display_order: int | None = None


class ReadingList(BaseModel):
    id: UUID
    name: str
    description: str | None = None
    color: str | None = None
    cover_image_r2_key: str | None = None
    auto_pin: bool
    is_system: bool
    starred: bool
    membership_rule: str | None = None
    display_order: int | None = None
    member_ids: list[int] = []
    created_at: datetime
    updated_at: datetime


class ReadingListMembers(BaseModel):
    """Add/remove works in a list (idempotent add; remove ignores absent)."""
    work_ids: list[int]


class ReadingListOrder(BaseModel):
    """Replace the full member ordering (Manual sort drag-and-drop)."""
    work_ids: list[int]


# --- saved_filters (§6.5) ----------------------------------------------------

class SavedFilterCreate(BaseModel):
    name: str
    filter_state_json: dict | None = None
    sort_state_json: dict | None = None
    starred: bool = False


class SavedFilterPatch(BaseModel):
    name: str | None = None
    filter_state_json: dict | None = None
    sort_state_json: dict | None = None
    starred: bool | None = None
    display_order: int | None = None


class SavedFilter(BaseModel):
    id: UUID
    name: str
    filter_state_json: dict | None = None
    sort_state_json: dict | None = None
    starred: bool
    display_order: int | None = None
    created_at: datetime
    updated_at: datetime


# --- pending_changes (pending-queue redesign — supersedes §12.2) --------------

class PendingAction(str, Enum):
    capture = "capture"        # add a new work (library: create; AO3: mark_for_later)
    mark_read = "mark_read"
    mark_unread = "mark_unread"
    mark_dnf = "mark_dnf"
    favorite = "favorite"      # library: is_favorite+Read; AO3: private bookmark+read
    unfavorite = "unfavorite"  # library: is_favorite=false; AO3: remove bookmark


class PendingSide(str, Enum):
    pending = "pending"
    done = "done"
    na = "na"                  # this action has no effect on this surface


class PendingOrigin(str, Enum):
    ao3 = "ao3"
    pwa = "pwa"


class PendingCreate(BaseModel):
    work_id: int
    action: PendingAction
    origin: PendingOrigin = PendingOrigin.pwa
    title: str | None = None
    author: str | None = None
    payload: dict = {}
    staging_key: str | None = None


class PendingChange(BaseModel):
    id: UUID
    work_id: int
    action: PendingAction
    title: str | None = None
    author: str | None = None
    payload: dict = {}
    staging_key: str | None = None
    ao3_state: PendingSide
    library_state: PendingSide
    origin: PendingOrigin
    error: str | None = None
    created_at: datetime
    updated_at: datetime


class CaptureRequest(BaseModel):
    """PWA "Add by URL" / share-target request. Either a full AO3 work URL (parsed
    server-side) or a bare work_id. The PWA can't scrape/fetch the epub (AO3's
    Cloudflare wall), so this only leaves a capture STUB; the PC drains it later
    (its content-script fetch fills in metadata + epub, superseding the stub)."""
    url: str | None = None
    work_id: int | None = None


class CaptureRequestResult(BaseModel):
    """Outcome of a request-capture call, so the PWA can toast the right thing."""
    status: str  # "queued" | "already_queued" | "already_in_library"
    work_id: int
    pending: PendingChange | None = None
