import { NavShell } from '../../components/NavShell'
import { TagManagement } from '../../components/TagManagement'

/* Tag Management surface inside the app shell — filterable tag table + bulk edit,
   plus the category list / lock sub-view. */
export function TagsSurface() {
  return (
    <div style={{ height: 680 }}>
      <NavShell>
        <TagManagement />
      </NavShell>
    </div>
  )
}
