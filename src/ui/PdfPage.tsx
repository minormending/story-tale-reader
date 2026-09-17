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

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || scale <= 0) return

    let cancelled = false
    const ratio = Math.min(window.devicePixelRatio || 1, 3)
    void renderPdfPage(pdf, page.index + 1, canvas, scale, ratio).catch(() => {
      if (!cancelled) canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
    })
    return () => {
      cancelled = true
    }
  }, [pdf, page.index, scale])

  return <canvas ref={canvasRef} className="pdf-canvas" aria-label={`Page ${page.index + 1}`} />
}
