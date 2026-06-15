/* Hub URL + bearer token (one shared token for all clients — docs/auth.md).
   Stored in localStorage; entered once by the user. */

const TOKEN_KEY = 'storyhub.token'
const HUB_KEY = 'storyhub.hub'
export const DEFAULT_HUB = 'https://ffstoryhub.up.railway.app'

export const getHub = () => localStorage.getItem(HUB_KEY) || DEFAULT_HUB
export const setHub = (u: string) => localStorage.setItem(HUB_KEY, u.replace(/\/$/, ''))
export const getToken = () => localStorage.getItem(TOKEN_KEY) || ''
export const setToken = (t: string) => localStorage.setItem(TOKEN_KEY, t.trim())
export const hasToken = () => getToken().length > 0

export const authHeaders = (): Record<string, string> => ({
  Authorization: `Bearer ${getToken()}`,
})
