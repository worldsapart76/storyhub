import { useState, type ReactNode } from 'react'
import './NavShell.css'
import { NAV_ITEMS } from '../mock/data'

/* App shell: sidebar on wide containers, bottom tabs on narrow (pwa-shell.md
   §7.2). Review Queue shows its count badge and would hide at 0 in the real app.
   Responsive purely via @container so it flips inside the phone frame. */

export function NavShell({ children }: { children?: ReactNode }) {
  const [active, setActive] = useState<string>('browse')

  return (
    <div className="shell">
      <nav className="shell__rail" aria-label="Primary">
        <div className="shell__brand">StoryHub</div>
        <div className="shell__navlist">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={'shell__nav' + (item.id === active ? ' is-active' : '')}
              onClick={() => setActive(item.id)}
            >
              <span className="shell__icon" aria-hidden>{item.icon}</span>
              <span className="shell__label">{item.label}</span>
              {'badge' in item && item.badge ? <span className="shell__badge">{item.badge}</span> : null}
            </button>
          ))}
        </div>
      </nav>

      <main className="shell__content">
        {children ?? <ShellPlaceholder active={active} />}
      </main>
    </div>
  )
}

function ShellPlaceholder({ active }: { active: string }) {
  const item = NAV_ITEMS.find((i) => i.id === active)
  return (
    <div className="shell__placeholder">
      <div className="shell__placeicon">{item?.icon}</div>
      <div>{item?.label}</div>
      <p>Surface content renders here (Step 3).</p>
    </div>
  )
}
