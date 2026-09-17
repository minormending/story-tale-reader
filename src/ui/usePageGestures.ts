import { useCallback, useRef, useState } from 'react'
import type { Size } from './useFrameSize'

/**
 * Tap, swipe, pinch and pan, across the page iframes.
 *
 * Book pages render in iframes, and a pointer event over an iframe is delivered to
 * that document — it does not bubble to ancestors in the parent. Handlers on the
 * stage alone therefore only ever saw the letterbox beside the artwork, so a swipe
 * across the picture, which is what anyone actually does, did nothing.
 *
 * Pages are same-origin, so the same listeners are attached to each page document
 * as it loads, and their coordinates are translated back into the parent's frame. A
 * gesture may start in one document, move through another and end on the stage; all
 * the state lives here, so that works.
 */

/** Minimum horizontal travel for a swipe, in CSS pixels of the parent frame. */
const SWIPE_THRESHOLD_PX = 45
/** Above this, a gesture is a drag rather than a tap. */
const TAP_SLOP_PX = 12
/** A swipe must be mostly horizontal to count. */
const HORIZONTAL_RATIO = 1.3

/** Zoom range. 4x is enough to inspect a detail in an illustration. */
const MIN_ZOOM = 1
const MAX_ZOOM = 4
/** Below this the zoom is treated as "off", so pan resets and paging comes back. */
const ZOOM_EPSILON = 0.02

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
  /** Frame the content is displayed in, and the size it is drawn at. Bounds the pan. */
  bounds?: { frame: Size; content: Size }
}

interface Point {
  x: number
  y: number
}

export interface Transform {
  zoom: number
  pan: Point
}

const IDENTITY: Transform = { zoom: 1, pan: { x: 0, y: 0 } }

/**
 * Translate a pointer event into the top document's coordinates.
 * Page iframes are CSS-transform-scaled, so the scale has to come out of the
 * rendered box rather than being assumed to be 1.
 */
function toParentPoint(event: PointerEvent): Point {
  const view =
    (event.currentTarget as Document | Element | null)?.ownerDocument?.defaultView ??
    (event.target as Element | null)?.ownerDocument?.defaultView
  const frame = view?.frameElement as HTMLIFrameElement | null
  if (!frame) return { x: event.clientX, y: event.clientY }

  const rect = frame.getBoundingClientRect()
  const scale = frame.offsetWidth > 0 ? rect.width / frame.offsetWidth : 1
  return { x: rect.left + event.clientX * scale, y: rect.top + event.clientY * scale }
}

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

export function usePageGestures(actions: GestureActions) {
  const latest = useRef(actions)
  latest.current = actions

  const [transform, setTransform] = useState<Transform>(IDENTITY)
  // Reading the live value inside handlers, which are not re-created per render.
  const current = useRef(transform)
  current.current = transform

  /** Every pointer currently down, in parent-frame coordinates. */
  const pointers = useRef(new Map<number, Point>()).current
  const gestureStart = useRef<{ point: Point; pointerId: number } | null>(null)
  /** True once a gesture has become something other than a tap or swipe. */
  const consumed = useRef(false)
  const pinch = useRef<{ distance: number; zoom: number; pan: Point; centre: Point } | null>(null)
  const panFrom = useRef<Point | null>(null)
  const attached = useRef(new WeakSet<Document>()).current

  /**
   * Keep the zoomed content overlapping the frame. Without this a pan can fling
   * the page off-screen entirely and leave a blank stage with no way back.
   */
  const clamp = useCallback((pan: Point, zoom: number): Point => {
    const bounds = latest.current.bounds
    if (!bounds) return pan
    const slackX = Math.max(0, (bounds.content.width * zoom - bounds.frame.width) / 2)
    const slackY = Math.max(0, (bounds.content.height * zoom - bounds.frame.height) / 2)
    return {
      x: Math.min(slackX, Math.max(-slackX, pan.x)),
      y: Math.min(slackY, Math.max(-slackY, pan.y)),
    }
  }, [])

  const apply = useCallback(
    (zoom: number, pan: Point) => {
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
      if (next <= MIN_ZOOM + ZOOM_EPSILON) {
        setTransform(IDENTITY)
        return
      }
      setTransform({ zoom: next, pan: clamp(pan, next) })
    },
    [clamp],
  )

  const resetZoom = useCallback(() => setTransform(IDENTITY), [])

  const isZoomed = (): boolean => current.current.zoom > MIN_ZOOM + ZOOM_EPSILON

  const begin = useCallback((event: PointerEvent) => {
    const point = toParentPoint(event)
    pointers.set(event.pointerId, point)

    if (pointers.size === 1) {
      gestureStart.current = { point, pointerId: event.pointerId }
      consumed.current = false
      panFrom.current = isZoomed() ? point : null
      return
    }

    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()]
      pinch.current = {
        distance: distance(a!, b!),
        zoom: current.current.zoom,
        pan: current.current.pan,
        centre: midpoint(a!, b!),
      }
      // A pinch is never also a tap or a swipe.
      consumed.current = true
      panFrom.current = null
    }
  }, [pointers])

  const move = useCallback(
    (event: PointerEvent) => {
      if (!pointers.has(event.pointerId)) return
      const point = toParentPoint(event)
      pointers.set(event.pointerId, point)

      const active = pinch.current
      if (active && pointers.size >= 2) {
        const [a, b] = [...pointers.values()]
        const spread = distance(a!, b!)
        if (active.distance <= 0) return
        const zoom = active.zoom * (spread / active.distance)
        // Keep the point between the fingers where it was: as the content grows by
        // `factor`, its offset from the frame centre grows by the same amount.
        const factor = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)) / active.zoom
        apply(zoom, {
          x: active.pan.x * factor,
          y: active.pan.y * factor,
        })
        return
      }

      const from = panFrom.current
      if (from && pointers.size === 1 && isZoomed()) {
        const delta = { x: point.x - from.x, y: point.y - from.y }
        if (Math.abs(delta.x) > 2 || Math.abs(delta.y) > 2) consumed.current = true
        panFrom.current = point
        apply(current.current.zoom, {
          x: current.current.pan.x + delta.x,
          y: current.current.pan.y + delta.y,
        })
      }
    },
    [apply, pointers],
  )

  const end = useCallback(
    (event: PointerEvent) => {
      const to = pointers.get(event.pointerId) ?? toParentPoint(event)
      pointers.delete(event.pointerId)

      if (pointers.size < 2) pinch.current = null
      if (pointers.size === 0) panFrom.current = null
      else {
        // A finger lifted from a pinch: let the remaining one pan from where it is.
        const remaining = [...pointers.values()][0]
        panFrom.current = remaining ?? null
        return
      }

      const from = gestureStart.current
      gestureStart.current = null
      if (!from || from.pointerId !== event.pointerId) return

      const wasConsumed = consumed.current
      consumed.current = false
      if (wasConsumed) return

      const dx = to.x - from.point.x
      const dy = to.y - from.point.y

      // While zoomed, horizontal travel is panning the picture, not turning the
      // page. Paging stays available from the chrome, and resetting brings it back.
      if (!isZoomed() && Math.abs(dx) > SWIPE_THRESHOLD_PX && Math.abs(dx) > Math.abs(dy) * HORIZONTAL_RATIO) {
        latest.current.onTurn(dx < 0 ? 1 : -1)
        return
      }

      if (Math.abs(dx) > TAP_SLOP_PX || Math.abs(dy) > TAP_SLOP_PX) return

      // Zoomed in, a tap is how you get back out. Page-turn zones would otherwise
      // make the zoomed view almost impossible to leave by touch alone.
      if (isZoomed()) {
        resetZoom()
        return
      }

      // Something on the page may want this tap for itself — a narrated word.
      if (latest.current.claimTap?.(event.target)) return

      // A tap. Edges turn the page, the middle band shows the controls.
      const width = window.innerWidth || 1
      const position = to.x / width
      if (position < 0.3) latest.current.onTurn(-1)
      else if (position > 0.7) latest.current.onTurn(1)
      else latest.current.onToggleChrome()
    },
    [pointers, resetZoom],
  )

  const cancel = useCallback(
    (event: PointerEvent) => {
      pointers.delete(event.pointerId)
      if (pointers.size < 2) pinch.current = null
      if (pointers.size === 0) {
        gestureStart.current = null
        panFrom.current = null
        consumed.current = false
      }
    },
    [pointers],
  )

  /**
   * The pointing-device equivalent of a pinch. A mouse or trackpad cannot pinch,
   * and ctrl/cmd + wheel is what every other zoomable surface uses.
   */
  const wheel = useCallback(
    (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      apply(current.current.zoom * Math.exp(-event.deltaY / 300), current.current.pan)
    },
    [apply],
  )

  const preventDrag = (event: Event): void => event.preventDefault()

  /** Attach to a book page's document so gestures over the artwork are seen. */
  const attachToPage = useCallback(
    (doc: Document) => {
      if (attached.has(doc)) return
      attached.add(doc)
      doc.addEventListener('pointerdown', begin)
      doc.addEventListener('pointermove', move)
      doc.addEventListener('pointerup', end)
      doc.addEventListener('pointercancel', cancel)
      // Not passive: zooming has to stop the browser zooming the whole page too.
      doc.addEventListener('wheel', wheel, { passive: false })
      // A page is mostly one big <img>, and dragging an image starts a native
      // drag-and-drop. That fires pointercancel instead of pointerup, so every
      // swipe across the artwork — the natural place to swipe — was swallowed.
      doc.addEventListener('dragstart', preventDrag)
    },
    [attached, begin, move, end, cancel, wheel],
  )

  return {
    attachToPage,
    transform,
    resetZoom,
    stageProps: {
      onPointerDown: (event: React.PointerEvent) => begin(event.nativeEvent),
      onPointerMove: (event: React.PointerEvent) => move(event.nativeEvent),
      onPointerUp: (event: React.PointerEvent) => end(event.nativeEvent),
      onPointerCancel: (event: React.PointerEvent) => cancel(event.nativeEvent),
      onWheel: (event: React.WheelEvent) => wheel(event.nativeEvent),
    },
  }
}
