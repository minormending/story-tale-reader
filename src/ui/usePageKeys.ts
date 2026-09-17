import { useCallback, useRef } from 'react'

/**
 * Keep keyboard paging working when focus is inside a book page.
 *
 * Book pages render in iframes. As soon as focus lands in one — a single Tab press
 * does it — key events go to that document instead of the app window, and paging,
 * Escape and every other shortcut stop working. The pages are same-origin, so the
 * same handler can be attached to each one as it loads.
 *
 * The handler is held in a ref so each document only ever needs one listener, no
 * matter how often the callback identity changes.
 */
export function usePageKeys(handler: (event: KeyboardEvent) => void) {
  const latest = useRef(handler)
  latest.current = handler

  const attached = useRef(new WeakSet<Document>()).current

  return useCallback(
    (doc: Document) => {
      if (attached.has(doc)) return
      attached.add(doc)
      doc.addEventListener('keydown', (event) => latest.current(event))
    },
    [attached],
  )
}
