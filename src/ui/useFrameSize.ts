import { useLayoutEffect, useRef, useState } from 'react'

export interface Size {
  width: number
  height: number
}

/**
 * Track an element's content-box size. Drives spread pairing and page scaling.
 *
 * The size is seeded synchronously from the element's own box before paint rather
 * than waiting for the first ResizeObserver callback. Without that the reader draws
 * one frame at 0x0 — which pairs as a portrait frame — so a landscape tablet would
 * flash a single page before snapping to a spread. It also keeps the layout correct
 * when the observer is starved, which happens whenever the page is not being
 * composited (a background tab, or a hidden window).
 */
export function useFrameSize<T extends HTMLElement>(): [React.RefObject<T | null>, Size] {
  const ref = useRef<T>(null)
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return

    const apply = (width: number, height: number): void => {
      setSize((current) =>
        current.width === width && current.height === height ? current : { width, height },
      )
    }

    const box = element.getBoundingClientRect()
    apply(Math.round(box.width), Math.round(box.height))

    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      apply(Math.round(entry.contentRect.width), Math.round(entry.contentRect.height))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return [ref, size]
}
