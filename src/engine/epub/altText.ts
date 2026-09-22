/**
 * Counting the pictures a book describes, and the ones it does not.
 *
 * In a fixed-layout picture book the illustration *is* the page. If it carries no
 * text alternative, a child using a screen reader gets a titled empty frame and
 * nothing else — which is the single largest accessibility gap this reader has,
 * and the one it cannot fix, because the words would have to come from whoever
 * made the book.
 *
 * What it can do is stop the gap being invisible. `schema:accessibilityFeature`
 * exists for publishers to declare `alternativeText`, but it is a claim, and it is
 * the claim most worth checking: counting `alt` attributes is cheap and the answer
 * is not a matter of opinion.
 */

import { attr, findAll, parseXml, textContent } from '../xml'

export interface AltTextCount {
  images: number
  /** Images carrying a non-empty text alternative. */
  described: number
  /**
   * Images explicitly marked as decorative — `alt=""` or `role="presentation"`.
   *
   * Counted apart from the undescribed, because an empty `alt` is an answer: it
   * says "there is nothing here worth reading out". Treating it as a failure would
   * punish the books that did the work.
   */
  decorative: number
}

export const EMPTY_ALT_COUNT: AltTextCount = { images: 0, described: 0, decorative: 0 }

/** A count, plus how much of the book it came from, so a partial answer says so. */
export interface AltTextEvidence extends AltTextCount {
  pagesChecked: number
  pageCount: number
}

/** One content document's worth. Malformed markup counts as nothing, not as a throw. */
export function countAltText(xml: string): AltTextCount {
  let root
  try {
    root = parseXml(xml)
  } catch {
    return { ...EMPTY_ALT_COUNT }
  }

  const count = { images: 0, described: 0, decorative: 0 }

  for (const img of findAll(root, 'img')) {
    count.images++
    const alt = attr(img, 'alt')
    const role = attr(img, 'role')
    if (role === 'presentation' || role === 'none' || alt === '') {
      count.decorative++
    } else if (alt && alt.trim()) {
      count.described++
    }
  }

  // SVG's <image> is the other way a fixed-layout page carries its picture, and a
  // scanned-page EPUB is as likely to use it as <img>. Its text alternative is a
  // child <title>, not an attribute.
  for (const image of findAll(root, 'image')) {
    count.images++
    const titled = findAll(image, 'title').some((t) => textContent(t).trim().length > 0)
    if (titled) count.described++
  }

  return count
}

export function addAltCounts(a: AltTextCount, b: AltTextCount): AltTextCount {
  return {
    images: a.images + b.images,
    described: a.described + b.described,
    decorative: a.decorative + b.decorative,
  }
}
