/**
 * The words a child tapped, kept per book.
 *
 * Per book rather than per reader, unlike the preferences in `settings.ts`: these
 * are about a particular story, and a list that mixed three books together would
 * not be a list of anything.
 */

import { get, put, STORE_WORDS } from './idb'
import { addTap, type TappedWord } from '../reader/wordList'

interface StoredWords {
  id: string
  words?: TappedWord[]
}

/** Never throws: a reader that will not open a book because a word list could not
 *  be read would be a poor trade (the same rule as `settings.ts`). */
export async function loadWords(bookId: string): Promise<TappedWord[]> {
  try {
    const stored = await get<StoredWords>(STORE_WORDS, bookId)
    return Array.isArray(stored?.words) ? stored.words : []
  } catch {
    return []
  }
}

/**
 * Record a tap and return the new list.
 *
 * Reads before writing rather than holding the list in memory, because a tap is
 * rare -- a few a page at most -- and the alternative is a cache to keep in step
 * with a store that other parts of the app can clear.
 */
export async function recordTap(
  bookId: string,
  tap: { text: string; pageIndex: number; elementId: string; order: number },
): Promise<TappedWord[]> {
  const current = await loadWords(bookId)
  const next = addTap(current, tap)
  if (next === current) return current
  try {
    await put<StoredWords>(STORE_WORDS, { id: bookId, words: next })
  } catch {
    // The list still holds for this session; it just will not outlive it.
  }
  return next
}

export async function clearWords(bookId: string): Promise<void> {
  try {
    await put<StoredWords>(STORE_WORDS, { id: bookId, words: [] })
  } catch {
    // Nothing to do: the reader asked to forget and we could not write it down.
  }
}
