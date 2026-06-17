/* App light/dark theme. Sets data-theme on <html> (tokens.css remaps the semantic
   tokens under [data-theme="dark"]). Persists the choice; defaults to the OS
   preference on first run. The Reader's reading theme is separate (Reader.tsx). */

import { useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'
const KEY = 'storyhub.theme'

function initialTheme(): Theme {
  const stored = localStorage.getItem(KEY)
  if (stored === 'light' || stored === 'dark') return stored
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(initialTheme)
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem(KEY, theme)
  }, [theme])
  return { theme, toggle: () => setTheme((t) => (t === 'light' ? 'dark' : 'light')) }
}
