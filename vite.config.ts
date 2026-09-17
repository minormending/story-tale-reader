import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { devCorpus } from './scripts/dev-corpus'

// GitHub Pages serves from /<repo>/; the Capacitor bundle serves from /.
// APP_BASE is the single knob — see .github/workflows/pages.yml and §14 of SPEC.md.
const base = process.env.APP_BASE ?? '/'

export default defineConfig({
  base,
  plugins: [
    react(),
    devCorpus(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      // The worker is registered by src/vfs/client.ts, which also needs to wait for
      // it to take control before any book iframe is created.
      injectRegister: false,
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
      // The virtual filesystem is not a progressive enhancement — fixed-layout
      // rendering needs it in development too.
      devOptions: { enabled: true, type: 'module', navigateFallback: 'index.html' },
      manifest: {
        name: 'Story Tale Reader',
        short_name: 'Story Tale',
        description: "A fixed-layout-first ebook reader for children's picture books.",
        theme_color: '#15141a',
        background_color: '#15141a',
        display: 'standalone',
        orientation: 'any',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
    }),
  ],
  build: { target: 'es2022', sourcemap: true },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
