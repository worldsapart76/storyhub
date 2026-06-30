/* Minimal app-wide toast bus. `toast()` from anywhere; <Toaster/> (mounted once at
   the app root) renders + auto-dismisses. Used to confirm queue actions ("Queued:
   Favorite — <title>") now that nothing updates instantly. */

export type ToastKind = 'ok' | 'warn' | 'err'
export type ToastMsg = { id: number; text: string; kind: ToastKind }

const listeners = new Set<(t: ToastMsg) => void>()
let seq = 0

export function toast(text: string, kind: ToastKind = 'ok'): void {
  seq += 1
  const msg: ToastMsg = { id: seq, text, kind }
  listeners.forEach((l) => l(msg))
}

export function onToast(cb: (t: ToastMsg) => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
