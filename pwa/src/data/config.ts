/* Hub URL + bearer token (one shared token for all clients — docs/auth.md).
   Stored in localStorage; entered once by the user. */

const TOKEN_KEY = 'storyhub.token'
const HUB_KEY = 'storyhub.hub'
export const DEFAULT_HUB = 'https://ffstoryhub.up.railway.app'

// localStorage wins (user-entered); else a dev-only .env.local fallback (VITE_*),
// so `npm run dev` auto-connects without typing. The DEV guard means the token is
// dead-code-eliminated from the PRODUCTION bundle — it never ships in the hosted
// app (which always shows the token gate).
export const getHub = () =>
  localStorage.getItem(HUB_KEY) || (import.meta.env.DEV ? import.meta.env.VITE_HUB : '') || DEFAULT_HUB
export const setHub = (u: string) => localStorage.setItem(HUB_KEY, u.replace(/\/$/, ''))
export const getToken = () =>
  localStorage.getItem(TOKEN_KEY) || (import.meta.env.DEV ? import.meta.env.VITE_AUTH_TOKEN : '') || ''
export const setToken = (t: string) => localStorage.setItem(TOKEN_KEY, t.trim())
export const hasToken = () => getToken().length > 0
export const clearToken = () => { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(HUB_KEY) }

/* Device pairing: a link/QR can carry the token (and optional hub) in the URL
   hash, so a hard-to-type device (e-reader) is set up by OPENING a link, not
   typing. The hash is never sent to the server (no log leak); we strip it from
   the address bar immediately after storing. Call once at startup before render. */
export function applyBootstrapFromUrl(): void {
  const raw = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : ''
  if (!raw) return
  const params = new URLSearchParams(raw)
  const token = params.get('token')
  if (!token) return
  setToken(token)
  const hub = params.get('hub')
  if (hub) setHub(hub)
  history.replaceState(null, '', window.location.pathname + window.location.search)
}

/* The pairing URL to send to another device (hub included only if non-default). */
export function pairingUrl(): string {
  const p = new URLSearchParams({ token: getToken() })
  const hub = getHub()
  if (hub !== DEFAULT_HUB) p.set('hub', hub)
  return `${window.location.origin}/#${p.toString()}`
}

export const authHeaders = (): Record<string, string> => ({
  Authorization: `Bearer ${getToken()}`,
})
