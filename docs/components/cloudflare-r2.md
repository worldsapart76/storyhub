# Cloudflare R2

> Source: §4.4 of the original StoryHub design doc.

[DECIDED]

Object storage, S3-compatible API, zero egress fees.

## Paths

- `/epubs/{calibre_id}.epub` — current epub per book
- `/snapshot/library-{version}.sqlite` — versioned library snapshots (keep last N for rollback)
- `/snapshot/current.json` — pointer file with latest version (`{version, r2_path, created_at}`)
- `/catalog/...` — X4 catalog EPUBs (currently SD-card-only; R2 hosting is a possible future add)
- `/staging/{queue_item_id}.epub` — temporary, cleaned after import

## Lifecycle

Keep everything. ~10 GB realistic ceiling = ~$0.15/month. No clearing logic.

Sizing context: library is ~7,343 books × ~500 KB ≈ 3.5 GB of epubs; snapshot
SQLite is a few MB.

## Provisioning status (Phase 0, done)

- Bucket: `storyhub`
- API token type: **User API Token** with Object Read & Write scoped to the `storyhub` bucket (matches the CollectCore pattern)
- Credentials (account ID, endpoint URL, access key ID, secret access key) are saved in the user's credential storage and set as Railway env vars

> When worker / Railway code needs these credentials, ask the user to paste
> them; do not assume any specific values.
