/**
 * Working out which books belong together.
 *
 * Picture books come in series, and a shelf of forty of them is far easier to use
 * grouped than alphabetical. The catch is that few of them say so, and those that
 * do say it inconsistently: on the test tablet's shelf, three Bluey books declare a
 * series called "Bluey" while two more say nothing and are titled "Bluey: Grandad"
 * and "Bluey: Granny Mobile"; one Amelia Bedelia book declares "Amelia Bedelia I
 * Can Read Level 1" and two others declare nothing; the same author is "West,
 * Tracey" on one book and "Tracey West" on the next. So the declared case has to be
 * handled, the common case inferred from titles and authors, and the two reconciled.
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
  /** Whether the books said so, or the shelf worked some of it out. */
  source: 'declared' | 'inferred'
  books: SeriesCandidate[]
}

/** A volume marker: "Book 2", "Vol. 3", "Part 4", "No. 5", "#6". */
const MARKER = String.raw`(?:\b(?:book|bk\.?|volume|vol\.?|part|pt\.?|no\.?|number)|#)\s*(\d+(?:\.\d+)?)`

/** Trailing: "Tippie Book 2", "Tippie, Vol. 3", "Tippie #5". */
const TRAILING_VOLUME = new RegExp(String.raw`[\s,:;–—-]*${MARKER}\s*$`, 'i')

/** Leading, before a subtitle: "Dragon Masters #2: Saving the Sun Dragon". */
const LEADING_VOLUME = new RegExp(String.raw`^(.+?)[\s,:;–—-]*${MARKER}\s*[:;–—-]\s*\S`, 'i')

/** A whole trailing parenthetical: "Learn to Read (Big Book 1)", "Power of the Fire Dragon (Dragon Masters #4)". */
const TRAILING_PARENTHETICAL = /\s*\(([^()]*)\)\s*$/

/** The marker at the end of a parenthetical's contents, with whatever words precede it. */
const PARENTHESISED_VOLUME = new RegExp(String.raw`^(.*?)[\s,:;–—-]*${MARKER}\s*$`, 'i')

/** A bracketed prefix, as file-naming tools write it: "[Step into Reading 01] Elmo Says Achoo!". */
const BRACKETED_PREFIX = /^\[([^\]]*?)[\s,#-]*(\d+(?:\.\d+)?)?\]\s*\S/

/** A bare trailing number: "Tippie 4". Only ever used when another book agrees. */
const BARE_NUMBER = /[\s,:;–—-]*\(?\s*(\d+(?:\.\d+)?)\s*\)?\s*$/

/** A series name before a colon: "Bluey: Grandad", "Fancy Nancy: Spring Fashion Fling". */
const COLON_PREFIX = /^([^:]+):\s*\S/

/** Words too weak to end a series name on, or to count towards one. */
const CONNECTORS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'for', 'in', 'on', 'at', 'is', 'are',
  'with', 'from', 'by', 'his', 'her', 'their', 'its',
])

/** Words that describe a contribution rather than name a person: "Alber, Diane, author, illustrator". */
const ROLES = new Set([
  'author', 'illustrator', 'illustrated', 'illus', 'ill', 'editor', 'ed', 'edited', 'adapter',
  'adapted', 'translator', 'translated', 'narrator', 'foreword', 'introduction', 'by',
])

/** Lowercased words, with apostrophes closed up so "O’Connor" and "OConnor" agree. */
function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/['’ʼ`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function words(value: string): string[] {
  return normalise(value).split(' ').filter(Boolean)
}

function significantWords(value: string): number {
  return words(value).filter((word) => !CONNECTORS.has(word)).length
}

/** Whether `text` opens with the whole words of `prefix` (both already normalised). */
function opensWith(text: string, prefix: string): boolean {
  return prefix.length > 0 && (text === prefix || text.startsWith(`${prefix} `))
}

/**
 * Who wrote a book, in a form where the ways one name gets written agree.
 *
 * "West, Tracey" and "Tracey West"; "O'Connor, Jane" and "jane oconnor"; "Alber,
 * Diane, author, illustrator" and "Diane Alber". Only the first of several authors
 * counts: "Herman Parish; Lynne Avril" is a Herman Parish book.
 */
export function authorKey(creator: string | undefined): string | undefined {
  if (!creator) return undefined
  let first = creator.split(/;|&|\band\b/i)[0] ?? ''
  // "Surname, Given" is one person; "Given Surname, Another Person" is two.
  const parts = first.split(',')
  if (parts.length > 1) first = words(parts[0] ?? '').length === 1 ? parts.slice(0, 2).join(' ') : (parts[0] ?? '')
  const tokens = words(first).filter((token) => !ROLES.has(token))
  return tokens.length > 0 ? [...tokens].sort().join(' ') : undefined
}

/** Drop trailing connectors, so a name reads as a name: "The Tale of" becomes "The Tale". */
function tidyName(parts: string[]): string {
  const kept = [...parts]
  while (kept.length > 0 && CONNECTORS.has(normalise(kept[kept.length - 1] ?? ''))) kept.pop()
  return kept.join(' ').replace(/[\s,:;–—-]+$/, '').trim()
}

function tidy(name: string): string {
  return tidyName(name.trim().split(/\s+/))
}

interface Hint {
  name: string
  key: string
  index?: number
}

function hint(name: string, index?: string): Hint | undefined {
  const tidied = tidy(name)
  const key = normalise(tidied)
  if (!key) return undefined
  return { name: tidied, key, index: index === undefined ? undefined : Number.parseFloat(index) }
}

/**
 * Series names a title carries alongside a number, most likely first.
 *
 * A number is strong evidence: "Tippie Book 1" and "Tippie Book 2" are one series
 * whoever wrote them. Where the number sits in parentheses with words of its own,
 * both readings are offered — "Learn to Read (Big Book 1)" is the series "Learn to
 * Read", "Power of the Fire Dragon (Dragon Masters #4)" is the series "Dragon
 * Masters" — and the shelf decides by which one other books agree with.
 */
function numberedHints(title: string): Hint[] {
  const out: Array<Hint | undefined> = []

  const bracketed = TRAILING_PARENTHETICAL.exec(title)
  const inner = bracketed ? PARENTHESISED_VOLUME.exec(bracketed[1] ?? '') : null
  if (bracketed && inner) {
    out.push(hint(title.slice(0, bracketed.index), inner[2]))
    out.push(hint(inner[1] ?? '', inner[2]))
  }

  const trailing = TRAILING_VOLUME.exec(title)
  if (trailing && trailing.index > 0) out.push(hint(title.slice(0, trailing.index), trailing[1]))

  const leading = LEADING_VOLUME.exec(title)
  if (leading) out.push(hint(leading[1] ?? '', leading[2]))

  const prefixed = BRACKETED_PREFIX.exec(title)
  if (prefixed) out.push(hint(prefixed[1] ?? '', prefixed[2]))

  const bare = BARE_NUMBER.exec(title)
  if (bare && bare.index > 0) out.push(hint(title.slice(0, bare.index), bare[1]))

  return out.filter((h): h is Hint => h !== undefined)
}

/** The name before a colon, which says "series" only when the author's other books agree. */
function colonHint(title: string): Hint | undefined {
  const match = COLON_PREFIX.exec(title)
  return match ? hint(match[1] ?? '') : undefined
}

/** The first `count` words of whichever title capitalises them most: "Never Let a Unicorn", not "Never let a unicorn". */
function bestCased(run: SeriesCandidate[], count: number): string[] {
  const openings = run.map((book) => book.title.split(/\s+/).slice(0, count))
  const capitals = (parts: string[]) => parts.join(' ').replace(/[^\p{Lu}]/gu, '').length
  return openings.reduce((best, next) => (capitals(next) > capitals(best) ? next : best), openings[0] ?? [])
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

interface Forming {
  name: string
  key: string
  /** Some member was placed by inference rather than by its own metadata. */
  inferred: boolean
  books: SeriesCandidate[]
  /** Position within the series, where the book or its title gives one. */
  positions: Map<string, number>
}

/**
 * Group a shelf into series.
 *
 * In order, each step only placing books the earlier ones left:
 *
 * 1. **What books declare**, taken at face value.
 * 2. **A number in the title.** Books whose titles name the same series beside a
 *    volume number group whoever wrote them, and one whose title names a series
 *    already on the shelf joins it.
 * 3. **A name before a colon**, shared by the same author ("Bluey: Grandad",
 *    "Bluey: Granny Mobile"), or naming a series already on the shelf.
 * 4. **A shared opening by the same author.** "Amelia Bedelia Is for the Birds" and
 *    "Amelia Bedelia Scared Silly" share two leading words and an author. The
 *    author check is what keeps this honest: without it, every book beginning "The
 *    Little" lands in one heap.
 * 5. **One series under two names** is merged: "Amelia Bedelia" and a declared
 *    "Amelia Bedelia I Can Read Level 1", when every book of the second is titled
 *    "Amelia Bedelia …".
 * 6. **Stragglers join a series their title opens with**, when the name is at least
 *    two real words and the authors do not disagree — which is how a PDF with no
 *    author finds its way into Fancy Nancy, and how the first book, titled just
 *    "Fancy Nancy", joins its sequels — or **whose name is their author**, as
 *    licensed books credit "Bluey".
 *
 * A group needs two books. A series of one is a list entry with a heading.
 */
export function groupIntoSeries(books: SeriesCandidate[]): SeriesGroup[] {
  const groups = new Map<string, Forming>()
  const placed = new Map<string, Forming>()

  const unplaced = (): SeriesCandidate[] => books.filter((book) => !placed.has(book.id))
  const start = (name: string, key: string): Forming => {
    const group: Forming = { name, key, inferred: false, books: [], positions: new Map() }
    groups.set(key, group)
    return group
  }
  const place = (group: Forming, book: SeriesCandidate, inferred: boolean, index?: number): void => {
    group.books.push(book)
    if (inferred) group.inferred = true
    if (index !== undefined && Number.isFinite(index)) group.positions.set(book.id, index)
    placed.set(book.id, group)
  }

  /* ------------------------- 1. what books declare ------------------------- */

  for (const book of books) {
    const name = book.series?.trim()
    const key = name ? normalise(name) : ''
    if (!name || !key) continue
    place(groups.get(key) ?? start(name, key), book, false, book.seriesIndex)
  }

  /* ------------------------- 2. a number in the title ------------------------- */

  for (const book of unplaced()) {
    for (const found of numberedHints(book.title)) {
      const group = groups.get(found.key)
      if (group) {
        place(group, book, true, found.index)
        break
      }
    }
  }

  // Of the names books agree on, the one the most books agree on goes first; the
  // likelier reading of a title breaks a tie.
  const hintsById = new Map(unplaced().map((book) => [book.id, numberedHints(book.title)]))
  for (;;) {
    const tally = new Map<string, { hint: Hint; books: Array<{ book: SeriesCandidate; index?: number }>; rank: number }>()
    for (const book of unplaced()) {
      ;(hintsById.get(book.id) ?? []).forEach((found, rank) => {
        const entry = tally.get(found.key) ?? { hint: found, books: [], rank }
        if (!entry.books.some((member) => member.book.id === book.id)) entry.books.push({ book, index: found.index })
        entry.rank = Math.min(entry.rank, rank)
        tally.set(found.key, entry)
      })
    }
    const best = [...tally.values()]
      .filter((entry) => entry.books.length >= 2 && !groups.has(entry.hint.key))
      .sort((a, b) => b.books.length - a.books.length || a.rank - b.rank || a.hint.key.localeCompare(b.hint.key))[0]
    if (!best) break
    const group = start(best.hint.name, best.hint.key)
    for (const { book, index } of best.books) place(group, book, true, index)
  }

  /* --------------------------- 3. a name before a colon --------------------------- */

  for (const book of unplaced()) {
    const found = colonHint(book.title)
    const group = found ? groups.get(found.key) : undefined
    if (group) place(group, book, true)
  }

  const byColon = new Map<string, { hint: Hint; books: SeriesCandidate[] }>()
  for (const book of unplaced()) {
    const author = authorKey(book.creator)
    const found = colonHint(book.title)
    if (!author || !found) continue
    const key = `${author}\u0000${found.key}`
    const entry = byColon.get(key) ?? { hint: found, books: [] }
    entry.books.push(book)
    byColon.set(key, entry)
  }
  for (const { hint: found, books: members } of byColon.values()) {
    if (members.length < 2) continue
    const group = groups.get(found.key) ?? start(found.name, found.key)
    for (const book of members) place(group, book, true)
  }

  /* ------------------ 4. a shared opening, by one author ------------------ */

  const byAuthor = new Map<string, SeriesCandidate[]>()
  for (const book of unplaced()) {
    const author = authorKey(book.creator)
    if (author) byAuthor.set(author, [...(byAuthor.get(author) ?? []), book])
  }

  for (const sameAuthor of byAuthor.values()) {
    if (sameAuthor.length < 2) continue
    // Sorting puts titles that begin alike next to each other, so one pass over
    // neighbours finds the runs.
    const sorted = [...sameAuthor].sort((a, b) => a.title.localeCompare(b.title))
    let run: SeriesCandidate[] = []
    let prefix: string[] = []

    const flush = (): void => {
      const name = tidyName(bestCased(run, prefix.length))
      // Two words of *shared prefix* is the guard against grouping on one common
      // word — "Winter Days" and "Winter Nights" are not a series. The guard belongs
      // there and not on the finished name: "Tippie and the Cat" and "Tippie and the
      // Hen" share three words and are plainly siblings, and trimming the connectors
      // off leaves the one word that is actually the series' name.
      if (run.length >= 2 && prefix.length >= 2 && name.length >= 4) {
        const key = normalise(name)
        const group = groups.get(key) ?? start(name, key)
        for (const book of run) place(group, book, true)
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

  /* ------------------------ 5. one series, two names ------------------------ */

  // Shortest names first, so each group is folded into the plainest name it has.
  const byLength = [...groups.values()].sort((a, b) => words(a.key).length - words(b.key).length)
  for (const plain of byLength) {
    if (!groups.has(plain.key) || significantWords(plain.name) < 2) continue
    for (const other of byLength) {
      if (other === plain || !groups.has(other.key) || !opensWith(other.key, plain.key)) continue
      if (!other.books.every((book) => opensWith(normalise(book.title), plain.key))) continue
      // The other group's numbering belonged to a differently named series.
      for (const book of other.books) place(plain, book, other.inferred)
      groups.delete(other.key)
    }
  }

  /* -------------------------- 6. the stragglers -------------------------- */

  const authorsAgree = (book: SeriesCandidate, group: Forming): boolean => {
    const author = authorKey(book.creator)
    if (!author) return true
    const known = group.books.map((member) => authorKey(member.creator)).filter(Boolean)
    return known.length === 0 || known.includes(author)
  }

  for (const book of unplaced()) {
    const title = normalise(book.title)
    const opening = [...groups.values()]
      .filter((group) => significantWords(group.name) >= 2 && opensWith(title, group.key) && authorsAgree(book, group))
      .sort((a, b) => b.key.length - a.key.length)[0]
    if (opening) {
      place(opening, book, true)
      continue
    }
    const author = authorKey(book.creator)
    const brand = author ? [...groups.values()].find((group) => authorKey(group.name) === author) : undefined
    if (brand) place(brand, book, true)
  }

  /* ------------------------------- result ------------------------------- */

  return [...groups.values()]
    .filter((group) => group.books.length >= 2)
    .map((group) => ({
      name: group.name,
      source: group.inferred ? ('inferred' as const) : ('declared' as const),
      books: [...group.books].sort((a, b) => byPosition(a, b, group.positions)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

function byPosition(a: SeriesCandidate, b: SeriesCandidate, positions: Map<string, number>): number {
  const ai = positions.get(a.id)
  const bi = positions.get(b.id)
  if (ai !== undefined && bi !== undefined && ai !== bi) return ai - bi
  if (ai !== undefined && bi === undefined) return -1
  if (ai === undefined && bi !== undefined) return 1
  return a.title.localeCompare(b.title)
}
