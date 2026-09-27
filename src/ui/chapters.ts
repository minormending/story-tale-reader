import type { NavItem } from '../engine/types'

/** Where a contents entry begins, as a position the reader moves through: a spread, or a section. */
export interface ChapterMark {
  position: number
  label: string
}

function flatten(items: NavItem[]): NavItem[] {
  return items.flatMap((item) => [item, ...flatten(item.children)])
}

/**
 * The book's contents as positions, for the page scrubber's ticks and its "you
 * would land in…" label.
 *
 * One mark per position, the first entry to reach it winning: a spread that holds
 * both "Cover" and "Title page" is where the cover is, and a section with several
 * anchors in it starts with the first of them. Entries that point at nothing in the
 * reading order, or have no label, are left out.
 */
export function chapterMarks(nav: NavItem[], positionOf: (path: string) => number): ChapterMark[] {
  const byPosition = new Map<number, string>()
  for (const item of flatten(nav)) {
    const label = item.label.trim()
    if (!item.path || !label) continue
    const position = positionOf(item.path)
    if (position < 0 || byPosition.has(position)) continue
    byPosition.set(position, label)
  }
  return [...byPosition.entries()]
    .map(([position, label]) => ({ position, label }))
    .sort((a, b) => a.position - b.position)
}

/** The chapter a position falls in: the last one to begin at or before it. */
export function chapterAt(marks: ChapterMark[], position: number): string | undefined {
  let found: string | undefined
  for (const mark of marks) {
    if (mark.position > position) break
    found = mark.label
  }
  return found
}
