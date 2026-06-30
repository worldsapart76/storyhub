import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import './Settings.css'
import { Button } from './Button'
import { clearToken, getHub, pairingUrl } from '../data/config'
import { useLibrary } from '../data/library'
import { clearCachedSnapshot } from '../data/idb'
import { toast } from '../data/toast'

/* Settings surface. Primary feature: device pairing — open the link (or scan the
   QR) on another device to sign it in without typing the token. */
export function Settings({ theme, onToggleTheme }: { theme?: 'light' | 'dark'; onToggleTheme?: () => void }) {
  const [url] = useState(pairingUrl)
  const [qr, setQr] = useState('')
  const [copied, setCopied] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [reloading, setReloading] = useState(false)
  const { reload } = useLibrary()

  useEffect(() => {
    QRCode.toDataURL(url, { width: 240, margin: 1 }).then(setQr).catch(() => setQr(''))
  }, [url])

  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500) }
    catch { /* clipboard blocked — the field is selectable as a fallback */ }
  }
  // Drop the locally-cached snapshot and re-download from the hub. Recovers a stale
  // or truncated local copy (the version-keyed cache otherwise never re-fetches).
  const reloadLibrary = async () => {
    setReloading(true)
    try {
      await clearCachedSnapshot()
      reload()
      toast('Re-downloading library…')
    } catch (e) {
      toast(`Reload failed: ${e instanceof Error ? e.message : e}`, 'err')
    } finally {
      setReloading(false)
    }
  }
  const signOut = () => {
    if (confirm('Sign out on this device? You’ll need the token (or a pairing link) to sign back in.')) {
      clearToken()
      location.reload()
    }
  }

  return (
    <div className="settings">
      <header className="settings__head"><h1 className="settings__title">Settings</h1></header>

      <section className="settings__section">
        <h2 className="settings__h2">Pair a device</h2>
        <div className="settings__pair">
          {qr && <img className="settings__qr" src={qr} alt="Pairing QR code" width={240} height={240} />}
          <div className="settings__pairctrls">
            <input className="settings__url" readOnly value={revealed ? url : url.replace(/token=[^&]+/, 'token=••••••••')}
              onFocus={(e) => e.currentTarget.select()} aria-label="Pairing link" />
            <div className="settings__btns">
              <Button variant="primary" size="sm" onClick={copy}>{copied ? '✓ Copied' : 'Copy link'}</Button>
              <Button variant="outline" size="sm" onClick={() => setRevealed((r) => !r)}>{revealed ? 'Hide' : 'Reveal'}</Button>
            </div>
            <p className="settings__warn">This link contains your access token — only send it to your own devices.</p>
          </div>
        </div>
      </section>

      {onToggleTheme && (
        <section className="settings__section">
          <h2 className="settings__h2">Appearance</h2>
          <div className="settings__row">
            <span>Theme</span>
            <Button variant="outline" size="sm" onClick={onToggleTheme}>
              {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
            </Button>
          </div>
        </section>
      )}

      <section className="settings__section">
        <h2 className="settings__h2">Library</h2>
        <div className="settings__row">
          <span>Reload library</span>
          <Button variant="outline" size="sm" onClick={reloadLibrary} disabled={reloading}>
            {reloading ? 'Reloading…' : 'Reload'}
          </Button>
        </div>
      </section>

      <section className="settings__section">
        <h2 className="settings__h2">Connection</h2>
        <div className="settings__row"><span>Hub</span><code className="settings__code">{getHub()}</code></div>
        <Button variant="ghost" size="sm" onClick={signOut}>Sign out of this device</Button>
      </section>
    </div>
  )
}
