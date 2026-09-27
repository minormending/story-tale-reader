import { groupIntoSeries } from '../engine/series'
import { tidyGroupName } from '../store/groupNames'
import type { LibraryEntry } from '../store/library'
import { sortShelf } from './shelf'

/**
 * How the shelf is laid out: the reader's own groups, the series the shelf worked
 * out, and everything else.
 *
 * The reader has the last word. A book they put in a group is in that group; a book
 * they took out of every group (`shelfGroup: null`) is loose, whatever its title
 * suggests; only the rest are grouped automatically. And when the reader's group
 * has the same name as a series the shelf found — they made a "Bluey" group, and
 * the shelf also saw "Bluey" in some titles — the two are one group, so adding a
 * book the shelf missed to a series is just adding it to a group of that name.
 */
export interface ShelfGroup {
  name: string
  /** The reader's group, what the books declared, or what the shelf worked out. */
  source: 'manual' | 'declared' | 'inferred'
  books: LibraryEntry[]
}

export interface ShelfLayout {
  groups: ShelfGroup[]
  loose: LibraryEntry[]
}

/**
 * Lay out books that are already sorted the way the shelf is showing them.
 *
 * A group sits where its best-placed book would have sat, so the sort still orders
 * the shelf; inside a series the books keep reading order, and inside the reader's
 * own group they go by title. The reader's groups show with any number of books,
 * since they made them; a series needs two.
 */
export function arrangeShelf(sorted: LibraryEntry[]): ShelfLayout {
  const manual = new Map<string, ShelfGroup>()
  const keyOf = (name: string) => tidyGroupName(name).toLowerCase()

  for (const entry of sorted) {
    if (typeof entry.shelfGroup !== 'string' || !tidyGroupName(entry.shelfGroup)) continue
    const key = keyOf(entry.shelfGroup)
    const group = manual.get(key) ?? { name: tidyGroupName(entry.shelfGroup), source: 'manual' as const, books: [] }
    group.books.push(entry)
    manual.set(key, group)
  }

  const automatic = sorted.filter((entry) => entry.shelfGroup === undefined)
  const byId = new Map(automatic.map((entry) => [entry.id, entry]))
  const series = groupIntoSeries(
    automatic.map((entry) => ({
      id: entry.id,
      title: entry.title,
      creator: entry.creator,
      series: entry.series,
      seriesIndex: entry.seriesIndex,
    })),
  )

  const groups: ShelfGroup[] = []
  const grouped = new Set<string>()
  for (const found of series) {
    const books = found.books.map((book) => byId.get(book.id)).filter((entry): entry is LibraryEntry => !!entry)
    const same = manual.get(keyOf(found.name))
    if (same) same.books.push(...books)
    else groups.push({ name: found.name, source: found.source, books })
    for (const book of books) grouped.add(book.id)
  }
  for (const group of manual.values()) {
    group.books = sortShelf(group.books, 'title')
    groups.push(group)
    for (const book of group.books) grouped.add(book.id)
  }

  const place = new Map(sorted.map((entry, index) => [entry.id, index]))
  const first = (group: ShelfGroup) => Math.min(...group.books.map((book) => place.get(book.id) ?? Infinity))
  groups.sort((a, b) => first(a) - first(b))

  return { groups, loose: sorted.filter((entry) => !grouped.has(entry.id)) }
}

/** Every group on the shelf, for choosing one to add a book to: the reader's first, then series. */
export function groupChoices(all: LibraryEntry[]): Array<{ name: string; count: number; source: ShelfGroup['source'] }> {
  return arrangeShelf(all)
    .groups.map((group) => ({ name: group.name, count: group.books.length, source: group.source }))
    .sort((a, b) => Number(b.source === 'manual') - Number(a.source === 'manual') || a.name.localeCompare(b.name))
}

