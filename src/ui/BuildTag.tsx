import { useState } from 'react'

/**
 * Which build you are actually looking at, and a way out when it is the wrong one.
 *
 * The service worker precaches the bundle, so a deploy does not reach an open tab
 * until the worker swaps — and a hard refresh does not force it, because the worker
 * still controls the navigation and still answers with what it has. There is no
 * browser control that fixes this. The app reloads itself when a newer worker takes
 * over (see vfs/client.ts), but that only helps when the worker actually updates;
 * this is the manual escape hatch for when it does not.
 *
 * So: the number is here to be read out when something looks wrong, and pressing it
 * unregisters every worker, drops every Cache API entry, and reloads.
 *
 * It deliberately leaves the library alone. The books live in OPFS and IndexedDB,
 * and throwing someone's shelf away to fix a stale bundle would be a terrible
 * trade — especially on a tablet where re-adding them means finding the files again.
 */
export function BuildTag() {
  const [clearing, setClearing] = useState(false)

  // A count renders as a version; anything else (a git-less build) is shown as-is,
  // so it cannot be mistaken for one.
  const label = /^\d+$/.test(__BUILD_ID__) ? `v${__BUILD_ID__}` : __BUILD_ID__

  const refresh = async (): Promise<void> => {
    setClearing(true)
    try {
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations()
        await Promise.all(registrations.map((registration) => registration.unregister()))
      }
      if ('caches' in window) {
        const keys = await caches.keys()
        await Promise.all(keys.map((key) => caches.delete(key)))
      }
    } catch {
      // Private windows and blocked storage throw here. Reloading is still worth
      // doing — it is the half that sometimes works on its own.
    }
    location.reload()
  }

  return (
    <button
      type="button"
      className="build-tag"
      onClick={() => void refresh()}
      disabled={clearing}
      title="Reload and fetch the newest version"
      // "Version v17" stutters; the spoken label takes the bare number.
      aria-label={`Version ${__BUILD_ID__}. Reload and fetch the newest version.`}
    >
      {clearing ? 'updating…' : label}
    </button>
  )
}
