import { useCallback, useEffect, useRef } from 'react'
import { bookFileUrl } from '../vfs/protocol'
import { reflowableStyles, screenCount, type Typography } from '../reader/typography'
import type { BookPage } from '../engine/types'
import type { Size } from './useFrameSize'

const STYLE_ID = 'story-tale-reflow-style'

/**
 * One reflowable spine document, paginated into screens.
 *
 * Paging is a whole-frame translation of the body rather than a scroll, because the
 * document's own overflow is hidden and programmatic scrolling of a multi-column
 * body is inconsistent between engines.
 */
export function ReflowableStage({
  bookId,
  page,
  frame,
  typography,
  screen,
  onMeasured,
}: {
  bookId: string
  page: BookPage
  frame: Size
  typography: Typography
  screen: number
  /** Reports how many screens this document turned out to occupy. */
  onMeasured: (count: number) => void
}) {
  const frameRef = useRef<HTMLIFrameElement>(null)

  const layout = useCallback(() => {
    const doc = frameRef.current?.contentDocument
    const body = doc?.body
    if (!doc || !body || frame.width <= 0) return

    let style = doc.getElementById(STYLE_ID)
    if (!style) {
      style = doc.createElement('style')
      style.id = STYLE_ID
      ;(doc.head ?? doc.documentElement).appendChild(style)
    }
    style.textContent = reflowableStyles(frame, typography)

    // Force layout before measuring, otherwise the column count lags a setting change.
    void body.offsetWidth
    onMeasured(screenCount(body, frame.width))
  }, [frame, typography, onMeasured])

  useEffect(() => {
    layout()
  }, [layout])

  useEffect(() => {
    const body = frameRef.current?.contentDocument?.body
    if (!body) return
    body.style.transform = `translateX(${-screen * frame.width}px)`
    body.style.willChange = 'transform'
  }, [screen, frame.width])

  return (
    <div className="reflow-slot" style={{ width: frame.width, height: frame.height }}>
      <iframe
        ref={frameRef}
        className="reflow-frame"
        title={page.printedPage ? `Page ${page.printedPage}` : `Section ${page.index + 1}`}
        src={bookFileUrl(bookId, page.path)}
        sandbox="allow-same-origin"
        scrolling="no"
        onLoad={layout}
        style={{ width: frame.width, height: frame.height }}
      />
    </div>
  )
}
