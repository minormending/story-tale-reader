/**
 * Working out which books belong together.
 *
 * Picture books come in series, and a shelf of forty of them is far easier to use
 * grouped than alphabetical. The catch is that almost none of them say so: of the
 * three real books this project develops against, not one carries series metadata,
 * and the only mention of a series anywhere is a sentence of marketing prose inside
 * a description. So the declared case has to be handled, and then the common case
 * has to be inferred from what is actually there — titles and authors.
 *
 * The bias throughout is against false grouping. A shelf where two unrelated books
 * are filed together is worse than a shelf where a series is missed: the first looks
 * broken, the second merely looks like a list.
 */

export interface SeriesCandidate {
  id: string
  title: string
  creator?: string
  /** From the book's own metadata, when it declares a series. */
  series?: string
  seriesIndex?: number
}

export interface SeriesGroup {
  name: string
  /** Whether the book said so, or the shelf worked it out. */
  source: 'declared' | 'inferred'
  books: SeriesCandidate[]
}

/** Trailing volume markers: "Book 2", "(Vol. 3)", ", Part 4", "#5". */
const VOLUME_SUFFIX =
  /[\s,:;–—-]*\(?\s*(?:book|bk\.?|volume|vol\.?|part|pt\.?|no\.?|number|#)\s*(\d+(?:\.\d+)?)\s*\)?\s*$/i

/** A bare trailing number: "Tippie 4". Only ever used when another book agrees. */
const BARE_NUMBER_SUFFIX = /[\s,:;–—-]*\(?\s*(\d+(?:\.\d+)?)\s*\)?\s*$/

/**
 * A whole trailing parenthetical that carries the number: "(Big Book 1)", "(Vol 2)".
 *
 * Checked before the others because the marker inside it may be preceded by words
 * of its own, and matching from the keyword alone leaves the opening bracket behind
 * on the stem — which then reads as a different series from its own sequel.
 */
const PARENTHETICAL_VOLUME =
  /\s*\([^)]*\b(?:book|bk\.?|volume|vol\.?|part|pt\.?|no\.?|number|#)\s*(\d+(?:\.\d+)?)\s*\)\s*$/i

/** Words too weak to end a series name on. */
const CONNECTORS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'for', 'in', 'on', 'at', 'is', 'are',
  'with', 'from', 'by', 'his', 'her', 'their', 'its',
])

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

function words(value: string): string[] {
  return normalise(value).split(' ').filter(Boolean)
}

/** A title with any trailing volume marker removed, plus the number it carried. */
function splitVolume(title: string): { stem: string; index?: number } {
  const bracketed = PARENTHETICAL_VOLUME.exec(title)
  if (bracketed?.[1]) {
    return { stem: title.slice(0, bracketed.index).trim(), index: Number.parseFloat(bracketed[1]) }
  }

  const marked = VOLUME_SUFFIX.exec(title)
  if (marked?.[1]) {
    return { stem: title.slice(0, marked.index).trim(), index: Number.parseFloat(marked[1]) }
  }
  const bare = BARE_NUMBER_SUFFIX.exec(title)
  if (bare?.[1] && bare.index > 0) {
    return { stem: title.slice(0, bare.index).trim(), index: Number.parseFloat(bare[1]) }
  }
  return { stem: title.trim() }
}

/** Drop trailing connectors, so a name reads as a name: "The Tale of" becomes "The Tale". */
function tidyName(parts: string[]): string {
  const kept = [...parts]
  while (kept.length > 0 && CONNECTORS.has(normalise(kept[kept.length - 1] ?? ''))) kept.pop()
  return kept.join(' ').replace(/[\s,:;–—-]+$/, '').trim()
}

function commonPrefix(a: string, b: string): string[] {
  const left = a.split(/\s+/)
  const right = b.split(/\s+/)
  const out: string[] = []
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    if (normalise(left[i] ?? '') !== normalise(right[i] ?? '')) break
    out.push(left[i] ?? '')
  }
  return out
}

function byPosition(a: SeriesCandidate, b: SeriesCandidate): number {
  const ai = a.seriesIndex ?? splitVolume(a.title).index
  const bi = b.seriesIndex ?? splitVolume(b.title).index
  if (ai !== undefined && bi !== undefined && ai !== bi) return ai - bi
  if (ai !== undefined && bi === undefined) return -1
  if (ai === undefined && bi !== undefined) return 1
  return a.title.localeCompare(b.title)
}

/**
 * Group a shelf into series.
 *
 * Declared series are taken at face value. Everything left over is inferred, by two
 * rules that both require at least two books to agree:
 *
 * 1. **A shared stem under a volume marker.** "Tippie Book 1" and "Tippie Book 2"
 *    are the same series whoever wrote them, because the numbering says so.
 * 2. **A shared opening, by the same author.** "Amelia Bedelia Is for the Birds" and
 *    "Amelia Bedelia Helps Out" share two leading words and an author. The author
 *    check is what keeps this honest — without it, every book beginning "The Little"
 *    lands in one heap.
 *
 * Books that match nothing are not in any group, and the caller lists them normally.
 */
export function groupIntoSeries(books: SeriesCandidate[]): SeriesGroup[] {
  const groups: SeriesGroup[] = []
  const claimed = new Set<string>()

  /* ------------------------- 1. what books declare ------------------------- */

  const declared = new Map<string, { name: string; books: SeriesCandidate[] }>()
  for (const book of books) {
    const name = book.series?.trim()
    if (!name) continue
    const key = normalise(name)
    const bucket = declared.get(key) ?? { name, books: [] }
    bucket.books.push(book)
    declared.set(key, bucket)
    claimed.add(book.id)
  }
  for (const { name, books: members } of declared.values()) {
    groups.push({ name, source: 'declared', books: [...members].sort(byPosition) })
  }

  /* ---------------------- 2. a shared numbered stem ---------------------- */

  const remaining = books.filter((book) => !claimed.has(book.id))
  const byStem = new Map<string, { name: string; books: SeriesCandidate[] }>()
  for (const book of remaining) {
    const { stem, index } = splitVolume(book.title)
    if (index === undefined) continue
    const name = tidyName(stem.split(/\s+/))
    if (words(name).length === 0) continue
    const key = normalise(name)
    const bucket = byStem.get(key) ?? { name, books: [] }
    bucket.books.push(book)
    byStem.set(key, bucket)
  }
  for (const { name, books: members } of byStem.values()) {
    if (members.length < 2) continue
    for (const book of members) claimed.add(book.id)
    groups.push({ name, source: 'inferred', books: [...members].sort(byPosition) })
  }

  /* ------------------ 3. a shared opening, by one author ------------------ */

  const left = books.filter((book) => !claimed.has(book.id) && book.creator)
  const byCreator = new Map<string, SeriesCandidate[]>()
  for (const book of left) {
    const key = normalise(book.creator ?? '')
    byCreator.set(key, [...(byCreator.get(key) ?? []), book])
  }

  for (const sameAuthor of byCreator.values()) {
    if (sameAuthor.length < 2) continue
    // Sorting puts titles that begin alike next to each other, so one pass over
    // neighbours finds the runs.
    const sorted = [...sameAuthor].sort((a, b) => a.title.localeCompare(b.title))
    let run: SeriesCandidate[] = []
    let prefix: string[] = []

    const flush = (): void => {
      const name = tidyName(prefix)
      // Two words of *shared prefix* is the guard against grouping on one common
      // word — "Winter Days" and "Winter Nights" are not a series. The guard belongs
      // there and not on the finished name: "Tippie and the Cat" and "Tippie and the
      // Hen" share three words and are plainly siblings, and trimming the connectors
      // off leaves the one word that is actually the series' name.
      if (run.length >= 2 && prefix.length >= 2 && name.length >= 4) {
        for (const book of run) claimed.add(book.id)
        groups.push({ name, source: 'inferred', books: [...run].sort(byPosition) })
      }
      run = []
      prefix = []
    }

    for (const book of sorted) {
      if (run.length === 0) {
        run = [book]
        continue
      }
      const shared = commonPrefix(prefix.length ? prefix.join(' ') : (run[0]?.title ?? ''), book.title)
      // Both titles must say something after the shared part, or one is simply the
      // other's opening and they are not siblings.
      const distinct =
        shared.length > 0 &&
        words(run[0]?.title ?? '').length > shared.length &&
        words(book.title).length > shared.length
      if (shared.length >= 2 && distinct) {
        prefix = shared
        run.push(book)
      } else {
        flush()
        run = [book]
      }
    }
    flush()
  }

  return groups.sort((a, b) => a.name.localeCompare(b.name))
}
