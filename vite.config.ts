import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves from /<repo>/; the Capacitor bundle serves from /.
// APP_BASE is the single knob — see .github/workflows/pages.yml and §14 of SPEC.md.
const base = process.env.APP_BASE ?? '/'

export default defineConfig({
  base,
  plugins: [react()],
  build: { target: 'es2022', sourcemap: true },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
