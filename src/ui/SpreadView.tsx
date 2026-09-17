import type { ReactNode } from 'react'
import type { BookPage, Spread, Viewport } from '../engine/types'
import type { Size } from './useFrameSize'

/**
 * Lay a spread out inside the available frame.
 *
 * The content box is always the full width of a two-page spread, even when one
 * side is blank, so the scale stays constant from the cover to the last page and
 * a lone page (a cover, or an unpaired verso) sits centred rather than jumping in
 * size. This is the `contain` fit from SPEC.md §5.4.
 */
export function spreadContentSize(spread: Spread, modal: Viewport): Viewport {
  if (spread.center) return spread.center.viewport
  const left = spread.left?.viewport
  const right = spread.right?.viewport
  return {
    width: (left?.width ?? modal.width) + (right?.width ?? modal.width),
    height: Math.max(left?.height ?? 0, right?.height ?? 0, modal.height),
  }
}

export function fitScale(content: Viewport, frame: Size): number {
  if (!frame.width || !frame.height || !content.width || !content.height) return 0
  return Math.min(frame.width / content.width, frame.height / content.height)
}

export function SpreadView({
  spread,
  modal,
  frame,
  renderPage,
}: {
  spread: Spread
  modal: Viewport
  frame: Size
  /** How to draw one page: an iframe for EPUB, a canvas for PDF. */
  renderPage: (page: BookPage, scale: number) => ReactNode
}) {
  const content = spreadContentSize(spread, modal)
  const scale = fitScale(content, frame)
  if (scale <= 0) return null

  const pages: BookPage[] = spread.center
    ? [spread.center]
    : [spread.left, spread.right].filter((p): p is BookPage => p !== undefined)

  return (
    <div
      className="spread"
      style={{ width: content.width * scale, height: content.height * scale }}
    >
      {pages.map((page) => (
        <div
          key={page.index}
          className="page-slot"
          style={{ width: page.viewport.width * scale, height: page.viewport.height * scale }}
        >
          {renderPage(page, scale)}
        </div>
      ))}
    </div>
  )
}
