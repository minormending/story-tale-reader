import { execSync } from 'node:child_process'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { devCorpus } from './scripts/dev-corpus'

/**
 * Which build this is, as a number someone can read out.
 *
 * The service worker precaches the bundle, so "am I looking at the current
 * version" is a question the page has to answer for itself — a hard refresh does
 * not go round the worker, which still controls the navigation and serves what it
 * already has.
 *
 * Commits, counted: monotonic, needs no bumping, and maps back to exactly one
 * commit — v17 is the 17th, findable with
 *
 *   git rev-list --reverse HEAD | sed -n '17p'
 *
 * This needs full history. actions/checkout clones shallow unless told otherwise,
 * which would pin every deployed build at 1, so the workflows that build
 * something a user sees set fetch-depth: 0.
 *
 * BUILD_ID pins it. A screenshot build must, because the count changes with every
 * commit and would otherwise make each visual baseline differ for a reason that
 * has nothing to do with the change under review.
 *
 * With no git at all — a tarball — it says 'dev' rather than inventing a number.
 * An obviously missing version is better than a wrong one when the whole point is
 * reading it out because something looks wrong.
 */
function buildId(): string {
  if (process.env.BUILD_ID) return process.env.BUILD_ID
  try {
    return (
      execSync('git rev-list --count HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim() || 'dev'
    )
  } catch {
    return 'dev'
  }
}

// GitHub Pages serves from /<repo>/; the Capacitor bundle serves from /.
// APP_BASE is the single knob — see .github/workflows/pages.yml and §14 of SPEC.md.
const base = process.env.APP_BASE ?? '/'

export default defineConfig({
  base,
  define: { __BUILD_ID__: JSON.stringify(buildId()) },
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
        // Bundle to a classic worker: module service workers are still not
        // universally supported, and the registration in vfs/client.ts is classic.
        rollupFormat: 'iife',
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
  // Source maps are 1.5MB of dead weight inside the APK; opt in when debugging a
  // deployed build with SOURCEMAP=true.
  build: { target: 'es2022', sourcemap: process.env.SOURCEMAP === 'true' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
