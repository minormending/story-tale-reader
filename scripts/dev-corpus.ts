import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
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
  return {
    name: 'story-tale-dev-corpus',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/corpus', (req, res, next) => {
        const url = (req.url ?? '/').split('?')[0] ?? '/'

        if (url === '/' || url === '/index.json') {
          const books = listBooks()
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(books))
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
      })
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
