# Status changes from dashboard

> Source: §7.5 of the original StoryHub design doc. For the full source matrix
> (how each `source` value is handled for AO3 sync), see
> [../architecture.md §5.3](../architecture.md).

[DECIDED]

Every story view (Browse result, reading list member, reader pane) has status
controls:

- Status chip showing current status, clickable to change
- Change → POSTs to `/api/status-updates` with `source: 'dashboard_manual'`
- Optimistically updates the local snapshot view, banner if write fails

Because `dashboard_manual` originates away from AO3, the worker enqueues an AO3
action (mark-read; + bookmark if the new status is Favorite) to
`/api/ao3-actions`. The next time the user loads any AO3 page, the extension
surfaces the pending-actions banner for one-tap execution.
