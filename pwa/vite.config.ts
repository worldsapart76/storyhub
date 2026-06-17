import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Phase F scaffold. PWA: installable + offline app shell. The library snapshot is
// cached separately in IndexedDB (data/idb.ts), so it's intentionally NOT precached
// here; workbox only owns the app shell (JS/CSS/wasm/icons).
export default defineConfig({
  // Built into the Railway hub's static dir so the FastAPI service serves the PWA
  // same-origin (railway/web). Not named dist/build, so it isn't gitignored and
  // `railway up` uploads it; it's a generated artifact (don't commit).
  build: { outDir: '../railway/web', emptyOutDir: true },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon-32x32.png', 'apple-touch-icon.png'],
      workbox: {
        // sql-wasm.wasm (~660KB) must be precached for offline — wasm isn't in the default globs.
        globPatterns: ['**/*.{js,css,html,wasm,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // Don't fall back to index.html for cross-origin API calls.
        navigateFallbackDenylist: [/^\/api\//],
      },
      manifest: {
        name: 'StoryHub',
        short_name: 'StoryHub',
        description: 'Personal AO3 library manager',
        theme_color: '#6366f1',
        background_color: '#f9fafb',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: { port: 5173, open: true },
})
