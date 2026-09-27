import { useEffect, useRef } from 'react'
import { renderPdfPage } from '../engine/pdf/load'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { BookPage } from '../engine/types'

/**
 * One PDF page, drawn to a canvas at the device's pixel density so text stays sharp
 * on a high-DPI tablet rather than being upscaled from CSS pixels.
 */
export function PdfPage({
  document: pdf,
  page,
  scale,
}: {
  document: PDFDocumentProxy
  page: BookPage
  scale: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // The last render into this canvas. pdf.js refuses a second render into a canvas
  // while one is still going, and cancelling takes effect asynchronously, so a redraw
  // at a new size waits for the old one to have stopped.
  const previous = useRef<Promise<unknown>>(Promise.resolve())

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || scale <= 0) return

    const controller = new AbortController()
    const ratio = Math.min(window.devicePixelRatio || 1, 3)
    const drawn = previous.current
      .then(() => (controller.signal.aborted ? undefined : renderPdfPage(pdf, page.index + 1, canvas, scale, ratio, controller.signal)))
      .catch(() => {
        if (!controller.signal.aborted) canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
      })
    previous.current = drawn
    return () => {
      // A scanned page takes seconds to draw on a cheap tablet, and turning past it
      // used to leave that work running and its decoded images held: stop the
      // render, then let pdf.js release the page once it has stopped. (cleanup is
      // a no-op while a newer render of the same page is still under way.)
      controller.abort()
      void drawn.finally(() => pdf.getPage(page.index + 1).then((proxy) => proxy.cleanup()).catch(() => undefined))
    }
  }, [pdf, page.index, scale])

  return <canvas ref={canvasRef} className="pdf-canvas" aria-label={`Page ${page.index + 1}`} />
}
