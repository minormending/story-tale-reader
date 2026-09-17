import { useEffect } from 'react'

/**
 * Keep the screen on while a book is open (SPEC.md §6.3).
 *
 * A picture book is read slowly — a child looking at an illustration can easily
 * outlast a 30-second screen timeout, and having the tablet go dark mid-story is
 * exactly the kind of small friction that makes a reader feel broken.
 *
 * Uses the Screen Wake Lock API rather than a Capacitor plugin: the same code then
 * works in the installed PWA on Android, not only inside the APK, and there is no
 * native surface to keep in step.
 *
 * The lock is released by the browser whenever the page stops being visible, and
 * is not restored on its own, so it has to be re-acquired on visibilitychange.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return

    let sentinel: WakeLockSentinel | null = null
    let released = false

    const acquire = async (): Promise<void> => {
      if (released || document.visibilityState !== 'visible' || sentinel) return
      try {
        sentinel = await navigator.wakeLock.request('screen')
        // A lock dropped by the system should not look held.
        sentinel.addEventListener('release', () => {
          sentinel = null
        })
      } catch {
        // Unsupported, blocked by policy, or the document lost visibility mid-call.
        // Reading works fine without it; there is nothing useful to tell anyone.
      }
    }

    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') void acquire()
    }

    void acquire()
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      released = true
      document.removeEventListener('visibilitychange', onVisibilityChange)
      void sentinel?.release().catch(() => {})
      sentinel = null
    }
  }, [active])
}
