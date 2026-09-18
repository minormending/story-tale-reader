import { useEffect, useRef, useState } from 'react'

/** How long the controls stay up before getting out of the way (SPEC.md §6.2). */
const HIDE_AFTER_MS = 3000

/**
 * Let the controls retire so the page is whole.
 *
 * The bars are drawn over the page, not beside it, so while they are up they cover
 * its top and bottom. On a reflowable book that is measurably the last line of
 * every screen — 63px of column underneath the bottom bar — and a reader had to
 * discover the centre tap to read it.
 *
 * Not hidden while a menu is open, which is anchored to the bar it came from, and
 * not while a *keyboard* user's focus is inside the bars: they would be left focused
 * on a control with no opacity and no pointer events, unable to see where they are.
 * Focus changes re-arm the timer, so the controls retire once attention moves on
 * rather than staying up for the rest of the session.
 *
 * Keyboard, specifically — `:focus-visible`, not focus. A press leaves focus on the
 * button it pressed, so guarding on focus alone meant one tap of Next or of the
 * padlock pinned the bars up for the rest of the book, which is the covering this
 * hook exists to undo. The audit caught it: the locked state waits for the bars to
 * retire and they never did, because locking is itself a press on a bar.
 */
export function useChromeAutoHide(visible: boolean, hide: () => void, paused: boolean): void {
  const [focusMoved, setFocusMoved] = useState(0)

  // Held in a ref rather than depended upon. Callers pass an inline arrow, which is
  // a new function every render, and depending on it restarted the countdown on
  // every render — so in a reader that re-renders while it is read, the controls
  // never retired at all.
  const dismiss = useRef(hide)
  dismiss.current = hide

  useEffect(() => {
    const rearm = (): void => setFocusMoved((count) => count + 1)
    document.addEventListener('focusin', rearm)
    document.addEventListener('focusout', rearm)
    return () => {
      document.removeEventListener('focusin', rearm)
      document.removeEventListener('focusout', rearm)
    }
  }, [])

  useEffect(() => {
    if (!visible || paused) return

    const timer = setTimeout(() => {
      const focused = document.activeElement
      if (focused instanceof HTMLElement && focused.closest('.chrome')) {
        // Parked there by keyboard: leave the bars alone until they move on.
        if (focused.matches(':focus-visible')) return
        // Left there by a press: the reader has no idea the button still holds
        // focus, so drop it rather than hide a control that would still answer
        // Enter from behind nothing.
        focused.blur()
      }
      dismiss.current()
    }, HIDE_AFTER_MS)

    return () => clearTimeout(timer)
  }, [visible, paused, focusMoved])
}
