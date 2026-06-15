import { useState } from 'react'
import { DEFAULT_HUB, getHub, setHub, setToken } from '../data/config'
import { Button } from './Button'

/* First-run / re-auth: capture the shared bearer token (docs/auth.md). */
export function TokenGate({ onConnected }: { onConnected: () => void }) {
  const [token, setTok] = useState('')
  const [hub, setHubUrl] = useState(getHub())
  const [showHub, setShowHub] = useState(false)

  const connect = () => {
    if (!token.trim()) return
    setToken(token)
    if (hub.trim() && hub.trim() !== DEFAULT_HUB) setHub(hub)
    onConnected()
  }

  return (
    <div style={wrap}>
      <div style={card}>
        <div style={brand}>StoryHub</div>
        <input
          style={input}
          type="password"
          placeholder="Access token"
          value={token}
          onChange={(e) => setTok(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && connect()}
          autoFocus
        />
        {showHub ? (
          <input style={input} placeholder="Hub URL" value={hub}
                 onChange={(e) => setHubUrl(e.target.value)} />
        ) : (
          <button style={link} onClick={() => setShowHub(true)}>Hub URL</button>
        )}
        <Button variant="primary" onClick={connect} disabled={!token.trim()}>Connect</Button>
      </div>
    </div>
  )
}

const wrap: React.CSSProperties = {
  display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 24,
}
const card: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 12, width: 'min(340px, 100%)',
}
const brand: React.CSSProperties = {
  fontSize: 28, fontWeight: 700, textAlign: 'center', marginBottom: 8,
}
const input: React.CSSProperties = {
  padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border, #ccc)',
  background: 'var(--surface, #fff)', color: 'inherit', font: 'inherit',
}
const link: React.CSSProperties = {
  background: 'none', border: 'none', color: 'var(--accent, #6a7)', cursor: 'pointer',
  fontSize: 13, alignSelf: 'flex-start', padding: 0,
}
