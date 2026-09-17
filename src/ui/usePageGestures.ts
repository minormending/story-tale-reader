import { useCallback, useRef } from 'react'

/**
 * Tap and swipe handling that survives the page iframes.
 *
 * Book pages render in iframes, and a pointer event over an iframe is delivered to
 * that document — it does not bubble to ancestors in the parent. Handlers on the
 * stage alone therefore only ever saw the letterbox beside the artwork, so a swipe
 * across the picture, which is what anyone actually does, did nothing.
 *
 * Pages are same-origin, so the same listeners are attached to each page document
 * as it loads, and their coordinates are translated back into the parent's frame.
 * A gesture may start in one document and end in another; the state lives here, so
 * that works too.
 */

/** Minimum horizontal travel for a swipe, in CSS pixels of the parent frame. */
const SWIPE_THRESHOLD_PX = 45
/** Above this, a gesture is a drag rather than a tap. */
const TAP_SLOP_PX = 12
/** A swipe must be mostly horizontal to count. */
const HORIZONTAL_RATIO = 1.3

export interface GestureActions {
  /** Called with -1 for a backwards turn, +1 for forwards. */
  onTurn: (direction: -1 | 1) => void
  /** A tap in the middle band. */
  onToggleChrome: () => void
  /**
   * Given what was tapped, whether something else owns this tap.
   *
   * Read-along uses it: tapping a word should read that word, not turn the page.
   * Only taps are offered — a swipe always turns, so a page whose text fills the
   * screen is still pageable.
   */
  claimTap?: (target: EventTarget | null) => boolean
}

interface Point {
  x: number
  y: number
  pointerId: number
}

/**
 * Translate a pointer event into the top document's coordinates.
 * Page iframes are CSS-transform-scaled, so the scale has to come out of the
 * rendered box rather than being assumed to be 1.
 */
function toParentPoint(event: PointerEvent): { x: number; y: number } {
  const view = (event.currentTarget as Document | Element | null)?.ownerDocument?.defaultView
    ?? (event.target as Element | null)?.ownerDocument?.defaultView
  const frame = view?.frameElement as HTMLIFrameElement | null
  if (!frame) return { x: event.clientX, y: event.clientY }

  const rect = frame.getBoundingClientRect()
  const scale = frame.offsetWidth > 0 ? rect.width / frame.offsetWidth : 1
  return { x: rect.left + event.clientX * scale, y: rect.top + event.clientY * scale }
}

export function usePageGestures(actions: GestureActions) {
  const latest = useRef(actions)
  latest.current = actions

  const start = useRef<Point | null>(null)
  const multiTouch = useRef(false)
  const attached = useRef(new WeakSet<Document>()).current

  const begin = useCallback((event: PointerEvent) => {
    if (start.current !== null) {
      // A second finger: this is a pinch, not a page turn.
      multiTouch.current = true
      return
    }
    multiTouch.current = false
    const point = toParentPoint(event)
    start.current = { ...point, pointerId: event.pointerId }
  }, [])

  const end = useCallback((event: PointerEvent) => {
    const from = start.current
    start.current = null
    if (!from || multiTouch.current || from.pointerId !== event.pointerId) return

    const to = toParentPoint(event)
    const dx = to.x - from.x
    const dy = to.y - from.y

    if (Math.abs(dx) > SWIPE_THRESHOLD_PX && Math.abs(dx) > Math.abs(dy) * HORIZONTAL_RATIO) {
      latest.current.onTurn(dx < 0 ? 1 : -1)
      return
    }

    if (Math.abs(dx) > TAP_SLOP_PX || Math.abs(dy) > TAP_SLOP_PX) return

    // Something on the page may want this tap for itself — a narrated word.
    if (latest.current.claimTap?.(event.target)) return

    // A tap. Edges turn the page, the middle band shows the controls.
    const width = window.innerWidth || 1
    const position = to.x / width
    if (position < 0.3) latest.current.onTurn(-1)
    else if (position > 0.7) latest.current.onTurn(1)
    else latest.current.onToggleChrome()
  }, [])

  const cancel = useCallback(() => {
    start.current = null
  }, [])

  const preventDrag = (event: Event): void => event.preventDefault()

  /** Attach to a book page's document so gestures over the artwork are seen. */
  const attachToPage = useCallback(
    (doc: Document) => {
      if (attached.has(doc)) return
      attached.add(doc)
      doc.addEventListener('pointerdown', begin)
      doc.addEventListener('pointerup', end)
      doc.addEventListener('pointercancel', cancel)
      // A page is mostly one big <img>, and dragging an image starts a native
      // drag-and-drop. That fires pointercancel instead of pointerup, so every
      // swipe across the artwork — the natural place to swipe — was swallowed.
      doc.addEventListener('dragstart', preventDrag)
    },
    [attached, begin, end, cancel],
  )

  return {
    attachToPage,
    stageProps: {
      onPointerDown: (event: React.PointerEvent) => begin(event.nativeEvent),
      onPointerUp: (event: React.PointerEvent) => end(event.nativeEvent),
      onPointerCancel: cancel,
    },
  }
}
