import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// `base` matters for GitHub Pages, where the app is served from
// https://<user>.github.io/<repo>/ rather than the domain root.
// Set BASE_PATH at build time; defaults to '/' for Netlify/Vercel/local.
const base = process.env.BASE_PATH ?? '/'

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon.png', 'icons/favicon.png'],
      manifest: {
        name: 'TripSplit — share trip expenses',
        short_name: 'TripSplit',
        description:
          'Split trip expenses with friends. Works fully offline, no account needed.',
        theme_color: '#0f766e',
        background_color: '#0b1120',
        display: 'standalone',
        orientation: 'portrait',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // The whole app must work with the phone in airplane mode, so every
        // build artifact is precached. There are no network calls at runtime.
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
        navigateFallback: `${base}index.html`,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
})
