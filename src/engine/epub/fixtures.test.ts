import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { loadEpub, type LayoutMeasurement } from './load'
import { bufferSource } from '../zip/reader'
import { buildSpreads } from '../layout/spread'
import { parseSmil } from '../overlays/smil'

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

describe.skipIf(!existsSync('public/sample/peter-rabbit.epub'))('the bundled sample book', () => {
  it('is a fixed-layout book that pairs from its page-list', async () => {
    const { book } = await loadEpub(
      bufferSource(readFileSync('public/sample/peter-rabbit.epub')),
    )

    expect(book.metadata.title).toBe('The Tale of Peter Rabbit')
    expect(book.metadata.creator).toBe('Beatrix Potter')
    expect(book.layout).toBe('pre-paginated')
    expect(book.layoutInferred).toBe(false)
    expect(book.spread).toBe('landscape')
    expect(book.pages.length).toBe(30)
    expect(book.coverPath).toBe('OEBPS/images/cover.jpg')

    // Every page is the same portrait viewport.
    for (const page of book.pages) expect(page.viewport).toEqual({ width: 800, height: 1200 })

    // No spine hints, so parity comes from printed page numbers — the case that
    // breaks other readers.
    expect(book.spreadSource).toBe('page-list')

    const spreads = buildSpreads(book.pages, book.direction, true)
    // Cover alone as a recto, then facing pairs all the way through.
    expect(spreads[0]!.right?.path).toBe('OEBPS/cover.xhtml')
    expect(spreads[0]!.left).toBeUndefined()
    expect(spreads[1]!.left?.path).toBe('OEBPS/title.xhtml')
    expect(spreads[1]!.right?.path).toBe('OEBPS/p01.xhtml')
  })

  it('carries no Project Gutenberg branding', async () => {
    const { book, archive } = await loadEpub(
      bufferSource(readFileSync('public/sample/peter-rabbit.epub')),
    )
    for (const page of book.pages) {
      const text = await archive.readText(page.path)
      expect(text).not.toMatch(/gutenberg/i)
    }
  })
})

/**
 * The narrated fixture exists for read-along across a page turn, which is the one
 * thing the reference book could prove and nothing redistributable could. Its
 * narration deliberately stops before the last spread, so both endings are here:
 * a spread that has somewhere to carry on to, and one that does not.
 */
describe.skipIf(!has('narrated-spreads'))('fixture: narrated spreads', () => {
  it('carries the overlay and the class the book highlights with', async () => {
    const { book } = await load('narrated-spreads')
    expect(book.layout).toBe('pre-paginated')
    expect(book.activeClass).toBe('-epub-media-overlay-active')
    // Pages 1-5 are narrated; 6 and 7 are back matter with no overlay at all.
    expect(book.pages.map((p) => Boolean(p.overlayPath))).toEqual([
      true, true, true, true, true, false, false,
    ])
  })

  it('pairs the narration into spreads that end mid-book', async () => {
    const { book } = await load('narrated-spreads')
    expect(book.spreadSource).toBe('explicit')
    expect(pairs(book)).toEqual([['center', 0], [1, 2], [3, 4], [5, 6]])
  })

  it('times every word, in order, against real audio', async () => {
    const { book, archive } = await load('narrated-spreads')
    const page = book.pages[1]!
    const fragments = parseSmil(await archive.readText(page.overlayPath!), page.overlayPath!)

    expect(fragments.map((f) => f.fragment)).toEqual(['w2-1', 'w2-2', 'w2-3', 'w2-4'])
    expect(fragments.map((f) => [f.start, f.end])).toEqual([
      [0, 0.4], [0.4, 0.8], [0.8, 1.2], [1.2, 1.6],
    ])
    // Every clip has to land inside a file that exists, or playback is silent and
    // the page never advances -- which is the failure this fixture is here for.
    for (const fragment of fragments) {
      expect(fragment.textPath).toBe(page.path)
      const audio = await archive.read(fragment.audioPath)
      expect(audio.length).toBeGreaterThan(44)
    }
  })

  it('leaves the last spread silent, so reading has a place to stop', async () => {
    const { book } = await load('narrated-spreads')
    const lastSpread = buildSpreads(book.pages, book.direction, true).at(-1)!
    expect([lastSpread.left?.overlayPath, lastSpread.right?.overlayPath]).toEqual([
      undefined, undefined,
    ])
  })
})

/**
 * Reusing a previous open's measurement.
 *
 * Measuring is the expensive half of opening a fixed-layout book, and it depends on
 * nothing but the file — whose identity is a hash of its bytes. Doing it once per
 * book rather than once per open is the difference between a picture book opening
 * instantly and a tablet appearing to hang.
 */
describe.skipIf(!has('fxl-explicit-spreads'))('fixture: reusing a measurement', () => {
  it('hands back a measurement matching the spine', async () => {
    const { book, measurement } = await load('fxl-explicit-spreads')
    expect(measurement.pageCount).toBe(book.pages.length)
    expect(measurement.viewports).toHaveLength(book.pages.length)
  })

  it('uses the cached sizes instead of reading the pages again', async () => {
    const { measurement } = await load('fxl-explicit-spreads')

    // A size the book does not contain. If it comes back out, the pages were not
    // read this time — which is the whole point of the cache.
    const invented = { width: 111, height: 222 }
    const planted: LayoutMeasurement = {
      ...measurement,
      viewports: measurement.viewports.map(() => invented),
    }

    const { book } = await loadEpub(bufferSource(readFileSync(fixture('fxl-explicit-spreads'))), {}, undefined, planted)
    expect(book.pages.map((page) => page.viewport)).toEqual(book.pages.map(() => invented))
  })

  it('ignores a measurement taken against a different number of pages', async () => {
    const { book: first, measurement } = await load('fxl-explicit-spreads')
    const stale: LayoutMeasurement = {
      ...measurement,
      pageCount: measurement.pageCount + 1,
      viewports: measurement.viewports.map(() => ({ width: 111, height: 222 })),
    }

    const { book } = await loadEpub(bufferSource(readFileSync(fixture('fxl-explicit-spreads'))), {}, undefined, stale)
    // Measured afresh, so the real sizes are back.
    expect(book.pages.map((p) => p.viewport)).toEqual(first.pages.map((p) => p.viewport))
  })
})
