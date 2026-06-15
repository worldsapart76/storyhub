import { ExtensionControls } from '../../components/ExtensionControls'

/* Extension injected controls — NOT inside the app NavShell: this is the UI the
   browser extension renders ON AO3 pages (capture, status badge, DNF, the hooked
   native actions, and the pending-actions drain banner). */
export function ExtensionSurface() {
  return <ExtensionControls />
}
