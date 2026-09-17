import { useCallback, useEffect, useRef, useState } from 'react'

/** How long the padlock must be held to leave lock mode. */
const UNLOCK_HOLD_MS = 3000

/**
 * Lock mode (SPEC.md §6.3, goal G6).
 *
 * Hand a tablet to a five-year-old and they will find the back button. Locking
 * takes away everything that leaves the book — the library, the menu, Escape —
 * while leaving everything that reads it: page turns, narration, zoom.
 *
 * Locking is a single tap, because nothing is lost by locking. Leaving is a
 * three-second hold, because that is the direction a child must not manage by
 * accident. The hold shows its progress, and the progress is driven by
 * requestAnimationFrame rather than a CSS transition: the app honours
 * prefers-reduced-motion by zeroing transition durations, which would have made a
 * three-second bar appear to fill instantly and told the parent nothing.
 */
export function LockButton({
  locked,
  onLock,
  onUnlock,
}: {
  locked: boolean
  onLock: () => void
  onUnlock: () => void
}) {
  const [progress, setProgress] = useState(0)
  const frame = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const startedAt = useRef(0)

  const stopHold = useCallback(() => {
    if (frame.current) cancelAnimationFrame(frame.current)
    frame.current = 0
    clearTimeout(timer.current)
    timer.current = undefined
    setProgress(0)
  }, [])

  useEffect(() => stopHold, [stopHold])

  const beginHold = useCallback(() => {
    if (!locked) {
      onLock()
      return
    }
    if (timer.current !== undefined) return

    startedAt.current = performance.now()

    // A timer decides when the hold is done; the animation frames only draw it.
    // Driving the unlock from requestAnimationFrame alone made the timing depend on
    // the page being composited — in a background or throttled tab the frames are
    // starved, and a three-second hold took as long as the next frame cared to
    // arrive.
    timer.current = setTimeout(() => {
      stopHold()
      onUnlock()
    }, UNLOCK_HOLD_MS)

    const tick = (): void => {
      setProgress(Math.min(1, (performance.now() - startedAt.current) / UNLOCK_HOLD_MS))
      frame.current = requestAnimationFrame(tick)
    }
    frame.current = requestAnimationFrame(tick)
  }, [locked, onLock, onUnlock, stopHold])

  return (
    <button
      type="button"
      className={`lock${locked ? ' lock-on' : ''}`}
      aria-pressed={locked}
      aria-label={
        locked
          ? 'Reading locked. Hold this button for three seconds to unlock.'
          : 'Lock reading, so the book cannot be left by accident'
      }
      title={locked ? 'Hold for 3 seconds to unlock' : 'Lock reading'}
      // Keyboard and assistive-technology activation arrives as a click with no
      // pointer behind it (detail 0), never as pointerdown — so without this the
      // padlock could not be operated at all without a mouse or a finger, and a
      // keyboard user who somehow got it locked would have had no way out. The
      // three-second hold guards small fingers, not deliberate key presses, so the
      // keyboard path toggles directly rather than being made unreachable.
      onClick={(event) => {
        if (event.detail !== 0) return
        if (locked) onUnlock()
        else onLock()
      }}
      onPointerDown={beginHold}
      onPointerUp={stopHold}
      onPointerLeave={stopHold}
      onPointerCancel={stopHold}
    >
      {/* Sized by the hold, not animated by CSS — see the note above. */}
      <span className="lock-fill" style={{ transform: `scaleX(${progress})` }} aria-hidden="true" />
      <span className="lock-face">{locked ? '\u{1F512}' : '\u{1F513}'}</span>
    </button>
  )
}
