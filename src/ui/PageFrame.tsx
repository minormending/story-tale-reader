import { useCallback } from 'react'
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
}: {
  bookId: string
  page: BookPage
  scale: number
  onReady?: (doc: Document, page: BookPage) => void
}) {
  const handleLoad = useCallback(
    (event: React.SyntheticEvent<HTMLIFrameElement>) => {
      const doc = event.currentTarget.contentDocument
      if (!doc) return
      injectViewerStyles(doc)
      onReady?.(doc, page)
    },
    [onReady, page],
  )

  return (
    <iframe
      className="page-frame"
      title={`Page ${page.printedPage ?? page.index + 1}`}
      src={bookFileUrl(bookId, page.path)}
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
    * { -webkit-tap-highlight-color: transparent; }
    body { -webkit-touch-callout: none; }
  `
  ;(doc.head ?? doc.documentElement).appendChild(style)
}
