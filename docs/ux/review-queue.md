# Review Queue

> Source: §7.9 of the original StoryHub design doc.

[DECIDED]

When stories come back from the worker flagged as review-needed (ship or
collection couldn't be auto-resolved):

- Table view: title, raw AO3 fandom, proposed collection (editable), raw AO3 ship, proposed ship (editable), Confirm button per row
- Bulk "Confirm all proposed" for rows where user is fine with the suggestion
- Inline editing: pick from dropdown of existing Calibre values, or type new
- "Skip / leave in queue" option per row — story stays imported as Unread without normalized values, user fixes later

Replaces the current FFF "Review Queue UI" with the same logic, prettier
presentation, and the freedom to confirm subsets.

This nav item only appears when count > 0. Confirmations are per-row, not
batched. See the normalization rules that produce these flags in
[../lifted-from-fff/normalization-rules.md](../lifted-from-fff/normalization-rules.md).

> **Hard rule:** do not bypass the Review Queue when writing `#ao3_work_id` /
> `#collection` / `#primaryship` metadata.
