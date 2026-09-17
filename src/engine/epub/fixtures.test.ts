import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { loadEpub } from './load'
import { bufferSource } from '../zip/reader'
import { buildSpreads } from '../layout/spread'

/**
 * End-to-end checks against the committed synthetic fixtures. These encode the
 * metadata shapes that cause real readers to mispair spreads, without shipping
 * anyone's copyrighted artwork.
 */

const fixture = (name: string) => `corpus/fixtures/${name}.epub`
const has = (name: string) => existsSync(fixture(name))

async function load(name: string, overrides = {}) {
  return loadEpub(bufferSource(readFileSync(fixture(name))), overrides)
}

const pairs = (book: Awaited<ReturnType<typeof load>>['book']) =>
  buildSpreads(book.pages, book.direction, true).map((s) =>
    s.center ? ['center', s.center.index] : [s.left?.index ?? null, s.right?.index ?? null],
  )

describe.skipIf(!has('fxl-no-spread-hints'))('fixture: no spread hints', () => {
  it('derives pairing from the page-list', async () => {
    const { book } = await load('fxl-no-spread-hints')
    expect(book.layout).toBe('pre-paginated')
    expect(book.spreadSource).toBe('page-list')
    // Page 1 is a recto alone; 2-3, 4-5, 6-7, 8-9 face each other.
    expect(pairs(book)).toEqual([[null, 0], [1, 2], [3, 4], [5, 6], [7, 8]])
  })

  it('re-phases every pair when the reader shifts', async () => {
    const { book } = await load('fxl-no-spread-hints', { spreadShift: 1 })
    expect(pairs(book)).toEqual([[0, 1], [2, 3], [4, 5], [6, 7], [8, null]])
  })
})

describe.skipIf(!has('fxl-explicit-spreads'))('fixture: explicit spread properties', () => {
  it('uses the book’s own hints', async () => {
    const { book } = await load('fxl-explicit-spreads')
    expect(book.spreadSource).toBe('explicit')
    expect(pairs(book)).toEqual([['center', 0], [1, 2], [3, 4], [5, 6], [7, 8]])
  })
})

describe.skipIf(!has('fxl-no-page-list'))('fixture: no page-list at all', () => {
  it('falls back to index parity with the cover alone', async () => {
    const { book } = await load('fxl-no-page-list')
    expect(book.spreadSource).toBe('index-parity')
    expect(pairs(book)).toEqual([['center', 0], [1, 2], [3, 4], [5, 6], [7, 8]])
  })
})

describe.skipIf(!has('fxl-rtl'))('fixture: right-to-left', () => {
  it('mirrors the pairing', async () => {
    const { book } = await load('fxl-rtl')
    expect(book.direction).toBe('rtl')
    const spreads = buildSpreads(book.pages, book.direction, true)
    // The reading-order-first page of each pair sits on the right.
    const pair = spreads.find((s) => s.left && s.right)!
    expect(pair.right!.index).toBeLessThan(pair.left!.index)
  })
})

describe.skipIf(!has('fxl-mixed-spread-page'))('fixture: a pre-composed double-width page', () => {
  it('gives the wide page the whole frame and keeps the rest paired', async () => {
    const { book } = await load('fxl-mixed-spread-page')
    const wide = book.pages[4]!
    expect(wide.viewport).toEqual({ width: 1600, height: 1200 })
    expect(wide.spreadSide).toBe('center')
    expect(pairs(book)).toContainEqual(['center', 4])
  })
})

describe.skipIf(!has('reflowable-chapters'))('fixture: reflowable', () => {
  it('is detected as reflowable and has no fixed viewports', async () => {
    const { book } = await load('reflowable-chapters')
    expect(book.layout).toBe('reflowable')
    expect(book.layoutInferred).toBe(false)
    expect(book.pages.length).toBe(4)
    expect(book.nav.map((item) => item.label)).toEqual([
      'Chapter 1', 'Chapter 2', 'Chapter 3', 'Chapter 4',
    ])
  })

  it('can be forced to render as fixed layout by the reader', async () => {
    const { book } = await load('reflowable-chapters', { forceLayout: 'pre-paginated' })
    expect(book.layout).toBe('pre-paginated')
  })
})
