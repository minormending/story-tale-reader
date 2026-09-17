import { useEffect, useRef, useState } from 'react'

export interface Size {
  width: number
  height: number
}

/** Track an element's content-box size. Drives spread pairing and page scaling. */
export function useFrameSize<T extends HTMLElement>(): [React.RefObject<T | null>, Size] {
  const ref = useRef<T>(null)
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const box = entry.contentRect
      setSize({ width: Math.round(box.width), height: Math.round(box.height) })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return [ref, size]
}
