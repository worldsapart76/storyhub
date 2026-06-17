import { useState, type ReactNode } from 'react'
import './NavShell.css'
import { NAV_ITEMS } from '../mock/data'

/* App shell: sidebar on wide containers, bottom tabs on narrow (pwa-shell.md
   §7.2). Review Queue shows its count badge and would hide at 0 in the real app.
   Responsive purely via @container so it flips inside the phone frame. */

/* Controlled when `active`/`onNavigate` are passed (the wired App routes), else
   self-manages (the design gallery). A theme toggle renders only when `theme`/
   `onToggleTheme` are supplied (the real app) — the gallery has its own. */
export function NavShell({ children, active: activeProp, onNavigate, theme, onToggleTheme, pending = 0 }: {
  children?: ReactNode
  active?: string
  onNavigate?: (id: string) => void
  theme?: 'light' | 'dark'
  onToggleTheme?: () => void
  pending?: number
}) {
  const [internal, setInternal] = useState<string>('browse')
  const active = activeProp ?? internal
  const navigate = onNavigate ?? setInternal

  return (
    <div className="shell">
      <nav className="shell__rail" aria-label="Primary">
        <div className="shell__brand">StoryHub</div>
        <div className="shell__navlist">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={'shell__nav' + (item.id === active ? ' is-active' : '')}
              onClick={() => navigate(item.id)}
            >
              <span className="shell__icon" aria-hidden>{item.icon}</span>
              <span className="shell__label">{item.label}</span>
              {'badge' in item && item.badge ? <span className="shell__badge">{item.badge}</span> : null}
            </button>
          ))}
        </div>
        {pending > 0 && (
          <div className="shell__pending" title={`${pending} change${pending === 1 ? '' : 's'} waiting to sync`}>
            <span aria-hidden>⟳</span> {pending} unsynced
          </div>
        )}
        {onToggleTheme && (
          <button className="shell__theme" onClick={onToggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            title={theme === 'dark' ? 'Light theme' : 'Dark theme'}>
            <span className="shell__icon" aria-hidden>{theme === 'dark' ? '☀️' : '🌙'}</span>
            <span className="shell__label">{theme === 'dark' ? 'Light' : 'Dark'}</span>
          </button>
        )}
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
