/**
 * Bookmarks (SPEC.md §16.3).
 *
 * A fixed-layout bookmark is just a spine index: the page is a fixed thing and
 * nothing the reader changes can move it.
 *
 * A reflowable one cannot be, and this is the problem §13 flagged as worth
 * revisiting when bookmarks landed. Screen numbers are a function of the current
 * type size — "section 3, screen 5" is a different place after someone presses
 * Bigger, so a bookmark stored that way silently drifts. Instead the anchor is the
 * *element* at the top of the screen, identified by its position among the body's
 * children. Re-finding an element and asking which screen it now falls on survives
 * a change of size, typeface or line spacing, which is the whole point of a
 * bookmark you set yesterday.
 */

import { STORE_BOOKMARKS, getAll, put, remove } from './idb'

export interface Bookmark {
  id: string
  bookId: string
  createdAt: number
  /** Spine index — the page for a fixed-layout book, the section for a reflowable one. */
  pageIndex: number
  /** Reflowable only: index of the body child at the top of the bookmarked screen. */
  anchor?: number
  /** What the list shows: a printed page number, or a section. */
  label: string
  /** Reflowable only: the opening words of the anchored block. */
  excerpt?: string
}

export async function listBookmarks(bookId: string): Promise<Bookmark[]> {
  const all = await getAll<Bookmark>(STORE_BOOKMARKS)
  return all
    .filter((bookmark) => bookmark.bookId === bookId)
    .sort((a, b) => a.pageIndex - b.pageIndex || (a.anchor ?? 0) - (b.anchor ?? 0))
}

export async function addBookmark(
  bookmark: Omit<Bookmark, 'id' | 'createdAt'>,
): Promise<Bookmark> {
  const saved: Bookmark = {
    ...bookmark,
    id:
      typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${bookmark.bookId}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    createdAt: Date.now(),
  }
  await put(STORE_BOOKMARKS, saved)
  return saved
}

export async function removeBookmark(id: string): Promise<void> {
  await remove(STORE_BOOKMARKS, id)
}

/** Called when a book leaves the library, so its bookmarks do not outlive it. */
export async function removeBookmarksFor(bookId: string): Promise<void> {
  const all = await getAll<Bookmark>(STORE_BOOKMARKS)
  await Promise.all(
    all.filter((bookmark) => bookmark.bookId === bookId).map((bookmark) => remove(STORE_BOOKMARKS, bookmark.id)),
  )
}
