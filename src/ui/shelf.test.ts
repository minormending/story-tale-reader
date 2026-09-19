import { describe, it, expect } from 'vitest'
import { matchesQuery, sortShelf, type ShelfSort } from './shelf'
import type { LibraryEntry } from '../store/library'

const book = (over: Partial<LibraryEntry>): LibraryEntry => ({
  id: over.title ?? 'id',
  title: 'Untitled',
  format: 'epub',
  fileName: 'x.epub',
  size: 1,
  addedAt: 0,
  lastOpenedAt: 0,
  pageCount: 1,
  layout: 'reflowable',
  hasMediaOverlays: false,
  ...over,
})

const order = (entries: LibraryEntry[], sort: ShelfSort): (string | undefined)[] =>
  sortShelf(entries, sort).map((e) => e.title)

describe('matchesQuery', () => {
  const peter = book({ title: 'The Tale of Peter Rabbit', creator: 'Beatrix Potter' })

  it('matches nothing typed with everything', () => {
    expect(matchesQuery(peter, '')).toBe(true)
    expect(matchesQuery(peter, '   ')).toBe(true)
  })

  it('finds a book by title or by author, whichever is remembered', () => {
    expect(matchesQuery(peter, 'peter')).toBe(true)
    expect(matchesQuery(peter, 'potter')).toBe(true)
    expect(matchesQuery(peter, 'badger')).toBe(false)
  })

  it('finds a book by its series, which is often the only name remembered', () => {
    const tippie = book({ title: 'Learn to Read 3', series: 'Tippie' })
    expect(matchesQuery(tippie, 'tippie')).toBe(true)
  })

  it('lets separate words match separate fields', () => {
    // "potter rabbit" is not a phrase in any one field, but it describes the book.
    expect(matchesQuery(peter, 'potter rabbit')).toBe(true)
    expect(matchesQuery(peter, 'potter badger')).toBe(false)
  })

  it('ignores case and accents', () => {
    const jose = book({ title: 'El Libro de José', creator: 'Ana Muñoz' })
    expect(matchesQuery(jose, 'jose')).toBe(true)
    expect(matchesQuery(jose, 'MUNOZ')).toBe(true)
  })
})

describe('sortShelf', () => {
  const a = book({ title: 'Zebra', creator: 'Ann Author', addedAt: 3, lastOpenedAt: 1 })
  const b = book({ title: 'The Apple', creator: 'Zoe Writer', addedAt: 1, lastOpenedAt: 3 })
  const c = book({ title: 'Mango', creator: undefined, addedAt: 2, lastOpenedAt: 2 })

  it('orders by title, ignoring a leading article', () => {
    // "The Apple" files under A, which is where a reader would look for it.
    expect(order([a, b, c], 'title')).toEqual(['The Apple', 'Mango', 'Zebra'])
  })

  it('orders by author, with the unattributed last', () => {
    expect(order([c, b, a], 'author')).toEqual(['Zebra', 'The Apple', 'Mango'])
  })

  it('orders by when a book was last read, newest first', () => {
    expect(order([a, b, c], 'recent')).toEqual(['The Apple', 'Mango', 'Zebra'])
  })

  it('orders by when a book was added, newest first', () => {
    expect(order([b, c, a], 'added')).toEqual(['Zebra', 'Mango', 'The Apple'])
  })

  it('breaks ties by title, so a whole folder added at once is not arbitrary', () => {
    const together = [
      book({ title: 'Second', addedAt: 5, lastOpenedAt: 5 }),
      book({ title: 'First', addedAt: 5, lastOpenedAt: 5 }),
    ]
    expect(order(together, 'added')).toEqual(['First', 'Second'])
    expect(order(together, 'recent')).toEqual(['First', 'Second'])
  })

  it('does not disturb the array it was given', () => {
    const entries = [a, b, c]
    sortShelf(entries, 'title')
    expect(entries.map((e) => e.title)).toEqual(['Zebra', 'The Apple', 'Mango'])
  })
})
