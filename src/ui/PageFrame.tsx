import { useCallback, useEffect, useState } from 'react'
import { bookFileUrl } from '../vfs/protocol'
import type { BookPage } from '../engine/types'

/**
 * One fixed-layout page (SPEC.md §5.4).
 *
 * The iframe is sized to the page's *intrinsic* viewport and then scaled with a CSS
 * transform. Nothing about the publisher's markup or stylesheet is touched, so the
 * absolute positioning that puts text on the illustration keeps working — which is
 * the entire reason this reader exists.
 *
 * `sandbox="allow-same-origin"` without `allow-scripts`: same-origin so read-along
 * can add the highlight class to the document, no scripts so book-supplied
 * JavaScript never runs. Granting both together would void the sandbox.
 */
export function PageFrame({
  bookId,
  page,
  scale,
  onReady,
  resolveInline,
}: {
  bookId: string
  page: BookPage
  scale: number
  onReady?: (doc: Document, page: BookPage) => void
  /**
   * Set when the service worker is unavailable: returns a self-contained document
   * for this page, which is handed to the iframe through srcdoc (SPEC.md §9.3).
   */
  resolveInline?: (path: string) => Promise<string>
}) {
  const [inlineHtml, setInlineHtml] = useState<string | null>(null)

  useEffect(() => {
    if (!resolveInline) return
    let cancelled = false
    void resolveInline(page.path).then((html) => {
      if (!cancelled) setInlineHtml(html)
    })
    return () => {
      cancelled = true
    }
  }, [resolveInline, page.path])

  const handleLoad = useCallback(
    (event: React.SyntheticEvent<HTMLIFrameElement>) => {
      const doc = event.currentTarget.contentDocument
      if (!doc) return
      injectViewerStyles(doc)
      onReady?.(doc, page)
    },
    [onReady, page],
  )

  if (resolveInline && inlineHtml === null) return null

  return (
    <iframe
      className="page-frame"
      title={`Page ${page.printedPage ?? page.index + 1}`}
      {...(resolveInline
        ? { srcDoc: inlineHtml ?? '' }
        : { src: bookFileUrl(bookId, page.path) })}
      sandbox="allow-same-origin"
      scrolling="no"
      // Out of the tab order: a Tab press landing inside a page would take key
      // events away from the app and break paging. Still reachable by screen
      // readers, which navigate the accessibility tree rather than the tab order.
      tabIndex={-1}
      onLoad={handleLoad}
      style={{
        width: page.viewport.width,
        height: page.viewport.height,
        transform: `scale(${scale})`,
        transformOrigin: '0 0',
      }}
    />
  )
}

const VIEWER_STYLE_ID = 'story-tale-viewer-style'

/**
 * The only thing injected into a book document. Deliberately touches nothing that
 * could move content: no margins, no font sizing, no layout properties.
 */
function injectViewerStyles(doc: Document): void {
  if (doc.getElementById(VIEWER_STYLE_ID)) return
  const style = doc.createElement('style')
  style.id = VIEWER_STYLE_ID
  style.textContent = `
    html, body { overflow: hidden !important; }
    /* The reader owns every gesture over a page — swipe to turn, pinch to zoom,
       pan while zoomed. Left to itself the browser would claim them first and the
       page turn or the zoom would never be seen. */
    html { touch-action: none; }
    * { -webkit-tap-highlight-color: transparent; }
    img, image, svg { -webkit-user-drag: none; user-select: none; }
    body { -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; }
  `
  ;(doc.head ?? doc.documentElement).appendChild(style)
}
