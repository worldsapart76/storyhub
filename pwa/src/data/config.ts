/* Hub URL + bearer token (one shared token for all clients — docs/auth.md).
   Stored in localStorage; entered once by the user. */

const TOKEN_KEY = 'storyhub.token'
const HUB_KEY = 'storyhub.hub'
export const DEFAULT_HUB = 'https://ffstoryhub.up.railway.app'

// localStorage wins (user-entered); else a dev .env.local fallback (VITE_*), so
// `npm run dev` auto-connects without typing. Production has no env -> the gate.
export const getHub = () =>
  localStorage.getItem(HUB_KEY) || import.meta.env.VITE_HUB || DEFAULT_HUB
export const setHub = (u: string) => localStorage.setItem(HUB_KEY, u.replace(/\/$/, ''))
export const getToken = () =>
  localStorage.getItem(TOKEN_KEY) || import.meta.env.VITE_AUTH_TOKEN || ''
export const setToken = (t: string) => localStorage.setItem(TOKEN_KEY, t.trim())
export const hasToken = () => getToken().length > 0

export const authHeaders = (): Record<string, string> => ({
  Authorization: `Bearer ${getToken()}`,
})
