/**
 * The words a child asked to hear again, offered when the story is over.
 *
 * The reader already lets a child tap any word to hear it (SPEC.md §7.1), and a
 * tap is a small confession: this is the word I did not catch. Collecting them
 * costs the story nothing, because the collecting is silent and the list is not
 * shown until the book is finished.
 *
 * That timing is the whole feature. An in-story dictionary is one of the few
 * enhancements the meta-analyses agree about, and they disagree with themselves
 * about it: it *hurt* comprehension and *helped* vocabulary
 * (docs/child-reading-research.md). Those findings are not in conflict — they say
 * *when*, not *whether*. Words looked at after the book is closed cost the story
 * nothing at all, which is why this is the one vocabulary feature here.
 */

export interface TappedWord {
  /** Normalised, and the identity of the entry: two taps on "Rabbit" are one word. */
  key: string
  /** As the book prints it, which is what a child will recognise on the page. */
  text: string
  /** Where it was first tapped, so the list can take the reader back to it. */
  pageIndex: number
  elementId: string
  /** Position in the book's narration: reading order, for the list's own order. */
  order: number
  taps: number
}

/**
 * A list longer than this is not one anybody reviews.
 *
 * It is also the point at which tapping has stopped meaning "I did not catch that"
 * and started meaning "I like tapping", which is a thing four-year-olds do.
 */
export const MAX_WORDS = 60

/**
 * Fold a word to its identity.
 *
 * Case and surrounding punctuation are noise here: a child who tapped `"Rabbit,`
 * and later `rabbit` asked about one word, and showing it twice would make the
 * list look like it is padding itself. Accents are kept, unlike the shelf search
 * (`shelf.ts`), because here the word is the content rather than a search term —
 * folding "José" to "jose" would be a change to what the book said.
 */
export function wordKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .trim()
}

/** The word as it should be shown: the book's own spelling, trimmed of padding. */
export function displayWord(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Record one tap.
 *
 * Returns the same array when there is nothing to record, so a caller can skip a
 * write. Repeat taps raise a count rather than adding a row: the count is the
 * useful part, being the difference between a word misheard once and a word that
 * stopped the child three times.
 */
export function addTap(
  words: readonly TappedWord[],
  tap: { text: string; pageIndex: number; elementId: string; order: number },
): TappedWord[] {
  const text = displayWord(tap.text)
  const key = wordKey(text)
  // Punctuation, a stray space, a tap that landed on an empty element.
  if (!key) return words as TappedWord[]

  const existing = words.findIndex((word) => word.key === key)
  if (existing !== -1) {
    const next = [...words]
    next[existing] = { ...next[existing]!, taps: next[existing]!.taps + 1 }
    return next
  }

  if (words.length >= MAX_WORDS) return words as TappedWord[]
  return [
    ...words,
    { key, text, pageIndex: tap.pageIndex, elementId: tap.elementId, order: tap.order, taps: 1 },
  ]
}

/**
 * Story order, not frequency.
 *
 * Ordering by how often a word was tapped would put the hardest first, which is
 * the right answer for a teacher and the wrong one for a child: the list then
 * reads as a ranking of their failures. In story order it reads as part of the
 * book they have just finished, which is what it is.
 *
 * `order` is the word's place in the narration, not its page. Sorting by page and
 * breaking ties any other way is not story order at all -- every word on a spread
 * shares a page, so "Once upon a" came out as "a, Once, upon" until this was the
 * key.
 */
export function sortWords(words: readonly TappedWord[]): TappedWord[] {
  return [...words].sort((a, b) => a.order - b.order || a.key.localeCompare(b.key))
}
