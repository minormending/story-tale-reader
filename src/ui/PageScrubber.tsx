import { useEffect, useRef, useState } from 'react'
import type { ChapterMark } from './chapters'

/**
 * Dragging through a book to find a place in it.
 *
 * A slider across the book's positions — its spreads, or its sections — with a
 * bubble above the thumb saying where letting go would land ("Pages 12–13 ·
 * Chapter 3") and, where one is cheap to have, a picture of that page. The book
 * only moves on release: rendering every page passed over would make a drag across
 * a hundred-page book a hundred renders on a tablet that takes a second over one.
 *
 * Chapters are ticks on the track, so a chapter's start is something to aim for.
 */
export function PageScrubber({
  count,
  position,
  label,
  marks,
  preview,
  onCommit,
  onScrubbing,
}: {
  count: number
  position: number
  /** What a position is, in words. */
  label: (position: number) => string
  marks?: ChapterMark[]
  /** A picture of a position, when one can be had cheaply. */
  preview?: (position: number) => Promise<string | undefined>
  onCommit: (position: number) => void
  /** While the thumb is held, so the controls around it do not hide themselves mid-drag. */
  onScrubbing?: (scrubbing: boolean) => void
}) {
  const [held, setHeld] = useState<number | null>(null)
  const [picture, setPicture] = useState<string | undefined>(undefined)
  const inputRef = useRef<HTMLInputElement>(null)
  const heldRef = useRef(held)
  heldRef.current = held
  const commit = useRef(onCommit)
  commit.current = onCommit
  const scrubbing = useRef(onScrubbing)
  scrubbing.current = onScrubbing

  // `change` is the browser's "let go": on release for a finger or a mouse, on each
  // step for the keyboard. React's onChange is `input`, which fires throughout.
  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    const release = (): void => {
      const target = heldRef.current ?? Number(input.value)
      setHeld(null)
      scrubbing.current?.(false)
      commit.current(target)
    }
    input.addEventListener('change', release)
    return () => input.removeEventListener('change', release)
  }, [])

  // A picture for where the thumb is, a moment after it stops moving.
  useEffect(() => {
    if (held === null || !preview) return
    let current = true
    const timer = window.setTimeout(() => {
      void preview(held).then((url) => {
        if (current) setPicture(url)
      })
    }, 80)
    return () => {
      current = false
      window.clearTimeout(timer)
    }
  }, [held, preview])

  useEffect(() => {
    if (held === null) setPicture(undefined)
  }, [held])

  if (count <= 1) return null

  const shown = held ?? position
  const fraction = (value: number): number => (count > 1 ? value / (count - 1) : 0)
  // Along the thumb's path, which starts and ends half a thumb in from each end.
  const along = (value: number): string => `calc(var(--thumb) / 2 + (100% - var(--thumb)) * ${fraction(value)})`

  return (
    <div className="scrubber">
      {held !== null && (
        <div
          className="scrubber-bubble"
          // Kept inside the bar at either end rather than hanging off the screen.
          style={{ left: `clamp(7.5rem, ${along(held)}, calc(100% - 7.5rem))` }}
          aria-hidden="true"
        >
          {picture && <img className="scrubber-picture" src={picture} alt="" />}
          <span className="scrubber-label">{label(held)}</span>
        </div>
      )}
      <div className="scrubber-track">
        {marks?.map((mark) => (
          <span key={mark.position} className="scrubber-mark" style={{ left: along(mark.position) }} />
        ))}
        <input
          ref={inputRef}
          className="scrubber-range"
          type="range"
          min={0}
          max={count - 1}
          step={1}
          value={shown}
          aria-label="Go to page"
          aria-valuetext={label(shown)}
          onChange={(event) => {
            if (heldRef.current === null) scrubbing.current?.(true)
            setHeld(Number(event.target.value))
          }}
          onPointerDown={() => scrubbing.current?.(true)}
          // A press that moved nothing fires no `change`, so let the controls go here.
          onPointerUp={() => {
            if (heldRef.current === null) scrubbing.current?.(false)
          }}
          onPointerCancel={() => {
            setHeld(null)
            scrubbing.current?.(false)
          }}
        />
      </div>
    </div>
  )
}
