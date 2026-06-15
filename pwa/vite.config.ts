import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Unwired design prototype (Phase P). No PWA plugin / virtualization yet —
// those land at Phase F when this becomes the real scaffold.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, open: true },
})
