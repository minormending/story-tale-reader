/**
 * What a screen reader is told when the page changes.
 *
 * The reader showed "3 / 12" in the toolbar and said nothing at all: there were no
 * live regions anywhere in it, so turning a page was silent and the reader had to
 * go hunting for what had changed. The toolbar text is also not worth speaking as
 * written — "three slash twelve" — and it hides itself after three seconds
 * (SPEC.md §6.2), so it cannot be the thing that carries the announcement.
 *
 * Kept separate from the components so the wording is testable without rendering a
 * book, and so there is one place to look when it reads oddly aloud.
 */

import type { BookPage } from '../engine/types'

/** Join a list the way it is said, not the way it is printed. */
function andList(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/**
 * A fixed-layout spread: one page, or two side by side.
 *
 * Prefers the labels printed in the book over the position in the spine, because
 * they are what a grown-up saying "go back to page six" means. Picture books
 * routinely start their numbering after several unnumbered leaves, so the two
 * disagree by more than an off-by-one.
 *
 * Falls back to the spread's own position when a book prints no page numbers,
 * which is most of them at this age, and says "of" rather than "slash".
 */
export function announceSpread(pages: BookPage[], spreadIndex: number, spreadCount: number): string {
  const printed = pages.map((page) => page.printedPage).filter((label): label is string => !!label)

  if (printed.length > 0 && printed.length === pages.length) {
    const noun = printed.length > 1 ? 'Pages' : 'Page'
    return `${noun} ${andList(printed)}`
  }

  const noun = pages.length > 1 ? 'Pages' : 'Page'
  const position = `${spreadIndex + 1} of ${spreadCount}`
  // Without printed labels the only honest unit is the spread, so name what is on
  // screen ("Pages") but count in spreads, which is what the toolbar shows too.
  return pages.length > 1 ? `${noun}, ${position}` : `${noun} ${position}`
}

/**
 * A reflowable screen within a section.
 *
 * Two numbers matter and neither alone is enough: which screenful of the current
 * chapter this is, and which chapter. Reading the chapter every time would be
 * unbearable on a long one, so it is named only when it changes — which the caller
 * decides, since only it knows what was said last.
 */
export function announceScreen(
  screen: number,
  screenCount: number,
  sectionLabel: string | undefined,
  includeSection: boolean,
): string {
  const where = `Screen ${screen + 1} of ${Math.max(screenCount, 1)}`
  if (includeSection && sectionLabel) return `${sectionLabel}. ${where}`
  return where
}
