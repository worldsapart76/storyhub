import { useEffect, useState } from 'react'
import './Toaster.css'
import { onToast, type ToastMsg } from '../data/toast'

/* App-root toast stack. Subscribes to the toast bus; auto-dismisses each after 3.2s. */
export function Toaster() {
  const [items, setItems] = useState<ToastMsg[]>([])
  useEffect(() =>
    onToast((t) => {
      setItems((prev) => [...prev, t])
      setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== t.id)), 3200)
    }), [])

  if (items.length === 0) return null
  return (
    <div className="toaster" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={'toaster__item toaster__item--' + t.kind}>{t.text}</div>
      ))}
    </div>
  )
}
