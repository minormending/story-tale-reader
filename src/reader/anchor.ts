/**
 * Where in a reflowable section a reader actually is, independent of type size.
 *
 * The body is laid out in columns and translated horizontally by whole frames, so
 * an element's offset from the start of the section is its `left` in the iframe's
 * viewport minus however far the body is currently translated. That offset changes
 * completely when the type size changes — but the *element* does not, which is why
 * a bookmark stores the element and asks again later which screen it has landed on.
 *
 * The translation is read back off the body rather than passed in. Measuring
 * happens right after a relayout, when the caller's idea of the current screen and
 * the transform actually applied to the body need not agree yet; the element's own
 * geometry and the body's own style always do.
 */

interface AnchorPoint {
  /** Index among the body's element children. */
  index: number
  /** The opening words, for the bookmark list. */
  excerpt: string
}

function translateX(body: HTMLElement): number {
  const match = /translateX\((-?[\d.]+)px\)/.exec(body.style.transform)
  return match ? Number.parseFloat(match[1]!) : 0
}

/** The block at the top of the currently visible screen. */
export function captureAnchor(doc: Document, frameWidth: number): AnchorPoint | undefined {
  const body = doc.body
  const children = body?.children
  if (!body || !children || children.length === 0 || frameWidth <= 0) return undefined

  const offset = translateX(body)
  // Where the visible screen starts, in the section's own coordinates.
  const screenStart = -offset
  let found = -1

  for (let i = 0; i < children.length; i++) {
    const natural = children[i]!.getBoundingClientRect().left - offset
    // Children are in document order, so the last one starting at or before this
    // screen is the one covering its top — anything later begins further on.
    if (natural <= screenStart + 2) found = i
    else break
  }

  const index = found === -1 ? 0 : found
  return {
    index,
    excerpt: (children[index]?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80),
  }
}

/** Which screen an anchored element falls on now. */
export function screenForAnchor(
  doc: Document,
  frameWidth: number,
  index: number,
): number | undefined {
  const body = doc.body
  const element = body?.children[index]
  if (!body || !element || frameWidth <= 0) return undefined
  const natural = element.getBoundingClientRect().left - translateX(body)
  // A hair of tolerance: a column boundary can land a fraction under the frame.
  return Math.max(0, Math.floor(natural / frameWidth + 0.01))
}

/**
 * Which screen a linked element falls on — the table of contents' equivalent.
 *
 * A contents entry names an element by id rather than by position, so unlike a
 * bookmark it needs no index. The arithmetic is the same: the element's offset
 * from the start of the section, divided by the width of a screen.
 *
 * Any element, not just a direct child of the body: a chapter heading is usually
 * one, but an entry pointing mid-section can name anything the author gave an id.
 */
export function screenForFragment(
  doc: Document,
  frameWidth: number,
  fragment: string,
): number | undefined {
  const body = doc.body
  if (!body || !fragment || frameWidth <= 0) return undefined
  const element = doc.getElementById(fragment)
  if (!element) return undefined
  const natural = element.getBoundingClientRect().left - translateX(body)
  return Math.max(0, Math.floor(natural / frameWidth + 0.01))
}
