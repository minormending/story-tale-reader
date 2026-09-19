import type { LibraryEntry } from '../store/library'

/**
 * Finding a book on a shelf, and choosing what order to see it in.
 *
 * A shelf that can absorb a folder in one drop needs both. Forty books arrive at
 * once, ordered by nothing a reader chose, and the only way to find one is to look
 * at all of them.
 */

export type ShelfSort = 'recent' | 'added' | 'title' | 'author'

export const SORT_LABELS: Record<ShelfSort, string> = {
  recent: 'Last read',
  added: 'Recently added',
  title: 'Title',
  author: 'Author',
}

/**
 * Compare as a reader reads, not as bytes sort.
 *
 * Diacritics are stripped so a search for "jose" finds "José", and case is folded
 * so "peter" finds "Peter". A parent typing into a search box is not thinking about
 * how the title was spelled.
 */
function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
}

/** Drop a leading article, so "The Tale of Peter Rabbit" files under T for Tale. */
function sortKey(value: string): string {
  return fold(value).replace(/^(the|a|an)\s+/, '')
}

/**
 * Does this book answer to what was typed?
 *
 * Title, author and series are all searched, because a reader looking for a book
 * may remember any one of the three — and on this shelf the series is often the
 * only name they remember, since picture books in a series share everything else.
 *
 * Every word must match something, but not the same something: "potter rabbit"
 * finds a Beatrix Potter book about a rabbit. Matching the whole phrase against one
 * field would not.
 */
export function matchesQuery(entry: LibraryEntry, query: string): boolean {
  const needles = fold(query).split(/\s+/).filter(Boolean)
  if (needles.length === 0) return true

  const haystack = fold([entry.title, entry.creator ?? '', entry.series ?? ''].join(' '))
  return needles.every((needle) => haystack.includes(needle))
}

/**
 * Order the shelf.
 *
 * Every sort falls back to title, so books that tie -- two added in the same drop,
 * two never opened -- come out in a stable, meaningful order rather than whatever
 * the store happened to return.
 */
export function sortShelf(entries: LibraryEntry[], sort: ShelfSort): LibraryEntry[] {
  const byTitle = (a: LibraryEntry, b: LibraryEntry): number =>
    sortKey(a.title).localeCompare(sortKey(b.title))

  return [...entries].sort((a, b) => {
    switch (sort) {
      case 'title':
        return byTitle(a, b)
      case 'author': {
        // Books with no author go last rather than sorting under the empty string.
        const left = sortKey(a.creator ?? '')
        const right = sortKey(b.creator ?? '')
        if (!left && right) return 1
        if (left && !right) return -1
        return left.localeCompare(right) || byTitle(a, b)
      }
      case 'added':
        return b.addedAt - a.addedAt || byTitle(a, b)
      case 'recent':
      default:
        return b.lastOpenedAt - a.lastOpenedAt || byTitle(a, b)
    }
  })
}
