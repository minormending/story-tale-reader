import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

const ROOT = resolve('corpus')
const EXTENSIONS = /\.(epub|pdf|mobi|azw3|prc)$/i

/**
 * Development only: serve `corpus/` over HTTP so the reader can open real books
 * without going through a file picker. This is what the browser-driven checks and
 * manual verification load. It never runs in a production build, and `corpus/local/`
 * is gitignored, so no in-copyright book is ever served publicly.
 */
export function devCorpus(): Plugin {
  const middleware = (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    const url = (req.url ?? '/').split('?')[0] ?? '/'

    if (url === '/' || url === '/index.json') {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(listBooks()))
      return
    }

    const file = resolve(join(ROOT, decodeURIComponent(url)))
    if (!file.startsWith(ROOT) || !existsSync(file) || !statSync(file).isFile()) {
      next()
      return
    }
    res.setHeader('Content-Type', 'application/octet-stream')
    res.setHeader('Content-Length', String(statSync(file).size))
    createReadStream(file).pipe(res)
  }

  // A flag in the served HTML, so the app only probes for the corpus when this
  // plugin is actually serving. Without it the production bundle fetched
  // /corpus/index.json on every load and 404ed for every real user.
  const marker = '<script>window.__STORY_TALE_CORPUS__ = true</script>'

  return {
    name: 'story-tale-dev-corpus',
    // `transformIndexHtml` also runs during `vite build`, which would bake the flag
    // into production and make every real user's browser fetch a corpus that isn't
    // there. Inject it only when a dev server is actually serving, or when a preview
    // build explicitly opts in.
    transformIndexHtml(html: string, ctx: { server?: unknown }) {
      const serving = ctx.server !== undefined || process.env.CORPUS_PREVIEW === 'true'
      return serving ? html.replace('</head>', `  ${marker}\n  </head>`) : html
    },
    configureServer(server) {
      server.middlewares.use('/corpus', middleware)
    },
    // `vite preview` too, so the production bundle can be exercised against real
    // books before it is deployed.
    configurePreviewServer(server) {
      server.middlewares.use('/corpus', middleware)
    },
  }
}

function listBooks(): Array<{ name: string; url: string; size: number }> {
  const out: Array<{ name: string; url: string; size: number }> = []
  for (const dir of ['local', 'fixtures']) {
    const full = join(ROOT, dir)
    if (!existsSync(full)) continue
    for (const name of readdirSync(full)) {
      if (!EXTENSIONS.test(name)) continue
      out.push({ name, url: `/corpus/${dir}/${name}`, size: statSync(join(full, name)).size })
    }
  }
  return out
}
