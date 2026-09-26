import { createReadStream, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

const ROOT = resolve('node_modules/pdfjs-dist')

/**
 * What pdf.js loads by name at run time, beyond its own script and worker.
 *
 * - `wasm/`: the JPEG 2000 (openjpeg) and JBIG2 decoders, and the colour-profile
 *   engine (qcms). Scanned books — most PDF picture books — store their pages as
 *   JPEG 2000 or JBIG2, and without these pdf.js draws them as blank white.
 * - `standard_fonts/`: for PDFs that name one of the fourteen standard fonts
 *   without embedding it.
 * - `iccs/`: the CMYK profile, for print-ready PDFs.
 *
 * Left out: the non-WASM fallbacks (every WebView this runs in has WASM), the
 * CJK character maps, and the JavaScript engine for PDF scripting.
 */
const FOLDERS: Record<string, RegExp> = {
  wasm: /^(openjpeg|jbig2|qcms_bg)\.wasm$/,
  standard_fonts: /\.(pfb|ttf)$/,
  iccs: /\.icc$/,
}

const TYPES: Record<string, string> = {
  wasm: 'application/wasm',
  pfb: 'application/octet-stream',
  ttf: 'font/ttf',
  icc: 'application/vnd.iccprofile',
}

function files(): string[] {
  return Object.entries(FOLDERS).flatMap(([folder, pattern]) =>
    readdirSync(join(ROOT, folder))
      .filter((name) => pattern.test(name))
      .map((name) => `${folder}/${name}`),
  )
}

/**
 * pdf.js's decoders and fonts, at `/pdfjs/<folder>/<name>`.
 *
 * pdf.js is given a folder URL for each (wasmUrl, standardFontDataUrl, iccUrl) and
 * asks for files by their own names, so they cannot go through Vite's asset
 * pipeline, which renames everything with a content hash. They are served from
 * node_modules in development and copied into the build under the same names.
 */
export function pdfjsAssets(): Plugin {
  const allowed = new Set(files())

  const middleware = (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    const path = decodeURIComponent((req.url ?? '').split('?')[0] ?? '').replace(/^\//, '')
    if (!allowed.has(path)) return next()
    const extension = path.slice(path.lastIndexOf('.') + 1)
    res.setHeader('Content-Type', TYPES[extension] ?? 'application/octet-stream')
    createReadStream(join(ROOT, path)).pipe(res)
  }

  return {
    name: 'story-tale-pdfjs-assets',
    configureServer(server) {
      server.middlewares.use('/pdfjs', middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use('/pdfjs', middleware)
    },
    generateBundle() {
      for (const path of allowed) {
        this.emitFile({ type: 'asset', fileName: `pdfjs/${path}`, source: readFileSync(join(ROOT, path)) })
      }
    },
  }
}
