/**
 * PDF support (SPEC.md §8.1).
 *
 * PDFs are described with the same ParsedBook shape as EPUBs, so they inherit the
 * whole viewer: spread pairing, the shift override, paging, resume. Only the page
 * renderer differs — a canvas instead of an iframe.
 */

import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { assignSpreadSides, type SpreadCandidate } from '../layout/spread'
import { modalViewport, DEFAULT_VIEWPORT } from '../layout/viewport'
import type { BookPage, LayoutOverrides, ParsedBook } from '../types'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export interface LoadedPdf {
  book: ParsedBook
  document: PDFDocumentProxy
}

export class PdfError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PdfError'
  }
}

export async function loadPdf(
  data: ArrayBuffer,
  fallbackTitle: string,
  overrides: LayoutOverrides = {},
): Promise<LoadedPdf> {
  let document: PDFDocumentProxy
  try {
    document = await pdfjs.getDocument({ data }).promise
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    if (/password/i.test(message)) {
      throw new PdfError('This PDF is password-protected, so it cannot be opened.')
    }
    throw new PdfError(`This PDF could not be read: ${message}`)
  }

  const pages: BookPage[] = []
  for (let number = 1; number <= document.numPages; number++) {
    const page = await document.getPage(number)
    const viewport = page.getViewport({ scale: 1 })
    pages.push({
      index: number - 1,
      id: `page-${number}`,
      path: `pdf:${number}`,
      viewport: { width: Math.round(viewport.width), height: Math.round(viewport.height) },
      // Replaced below, once every page size is known.
      spreadSide: 'center',
      printedPage: String(number),
      linear: true,
    })
  }

  // A PDF carries no page-spread hints and no page-list, so pairing comes from page
  // order — with the first page standing alone as a cover, and any double-width page
  // (a scanned spread) taking the frame to itself.
  const modal = modalViewport(pages.map((page) => page.viewport)) ?? DEFAULT_VIEWPORT
  const candidates: SpreadCandidate[] = pages.map((page) => ({
    index: page.index,
    path: page.path,
    properties: [],
    viewport: page.viewport,
  }))
  const assignment = assignSpreadSides(candidates, {
    pageList: new Map(),
    direction: 'ltr',
    modal,
    shift: overrides.spreadShift ?? 0,
  })
  pages.forEach((page, index) => {
    page.spreadSide = assignment.sides[index] ?? 'center'
  })

  const info = await document.getMetadata().catch(() => undefined)
  const metaTitle = (info?.info as { Title?: string } | undefined)?.Title
  const author = (info?.info as { Author?: string } | undefined)?.Author

  const book: ParsedBook = {
    format: 'pdf',
    metadata: {
      title: metaTitle?.trim() || fallbackTitle,
      creator: author?.trim() || undefined,
    },
    layout: 'pre-paginated',
    layoutInferred: false,
    spread: 'landscape',
    // A PDF carries no page-spread hints and no page-list, so pairing always comes
    // from page order — which is exactly what the shift override exists for.
    spreadSource: 'index-parity',
    direction: 'ltr',
    pages,
    nav: await outline(document),
    hasMediaOverlays: false,
    packagePath: '',
  }

  return { book, document }
}

async function outline(document: PDFDocumentProxy): Promise<ParsedBook['nav']> {
  try {
    const items = await document.getOutline()
    if (!items) return []
    return items.slice(0, 200).map((item) => ({
      label: item.title,
      href: '',
      path: '',
      fragment: '',
      children: [],
    }))
  } catch {
    return []
  }
}

/** Render one page into a canvas at the given CSS scale, sharp on high-DPI screens. */
export async function renderPdfPage(
  document: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  cssScale: number,
  devicePixelRatio: number,
): Promise<void> {
  const page = await document.getPage(pageNumber)
  const viewport = page.getViewport({ scale: cssScale * devicePixelRatio })

  canvas.width = Math.round(viewport.width)
  canvas.height = Math.round(viewport.height)
  canvas.style.width = `${Math.round(viewport.width / devicePixelRatio)}px`
  canvas.style.height = `${Math.round(viewport.height / devicePixelRatio)}px`

  const context = canvas.getContext('2d')
  if (!context) throw new PdfError('This device could not provide a drawing surface')
  await page.render({ canvas, canvasContext: context, viewport }).promise
}
