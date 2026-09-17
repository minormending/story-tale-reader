import { describe, it, expect } from 'vitest'
import { assignSpreadSides, buildSpreads, shouldPair, type SpreadCandidate } from './spread'
import type { BookPage, SpreadSide, Viewport } from '../types'

const VIEWPORT: Viewport = { width: 800, height: 1200 }

function candidates(count: number, properties: string[][] = []): SpreadCandidate[] {
  return Array.from({ length: count }, (_, index) => ({
    index,
    path: `OEBPS/p${index}.xhtml`,
    properties: properties[index] ?? [],
    viewport: VIEWPORT,
  }))
}

function pagesFrom(sides: SpreadSide[]): BookPage[] {
  return sides.map((spreadSide, index) => ({
    index, id: `p${index}`, path: `OEBPS/p${index}.xhtml`,
    viewport: VIEWPORT, spreadSide, linear: true,
  }))
}

describe('assignSpreadSides', () => {
  it('honours explicit page-spread properties, prefixed or not', () => {
    const input = candidates(4, [
      ['rendition:page-spread-center'],
      ['page-spread-left'],
      ['page-spread-right'],
      ['rendition:page-spread-left'],
    ])
    const { sides, source } = assignSpreadSides(input, {
      pageList: new Map(), direction: 'ltr', modal: VIEWPORT,
    })
    expect(source).toBe('explicit')
    expect(sides).toEqual(['center', 'left', 'right', 'left'])
  })

  it('derives parity from the nav page-list when the spine has no hints', () => {
    // This is the reference book's shape: cover=1, two title pages, then content.
    const input = candidates(6)
    const pageList = new Map([
      ['OEBPS/p0.xhtml', '1'], ['OEBPS/p1.xhtml', '2'], ['OEBPS/p2.xhtml', '3'],
      ['OEBPS/p3.xhtml', '4'], ['OEBPS/p4.xhtml', '5'], ['OEBPS/p5.xhtml', '6'],
    ])
    const { sides, source } = assignSpreadSides(input, { pageList, direction: 'ltr', modal: VIEWPORT })
    expect(source).toBe('page-list')
    // Even printed pages are versos (left); page 1 is a recto with no facing verso.
    expect(sides).toEqual(['right', 'left', 'right', 'left', 'right', 'left'])
  })

  it('pairs the reference book so pages 12 and 13 face each other', () => {
    const input = candidates(14)
    const pageList = new Map(input.map((c, i) => [c.path, String(i + 1)]))
    const { sides } = assignSpreadSides(input, { pageList, direction: 'ltr', modal: VIEWPORT })
    const spreads = buildSpreads(pagesFrom(sides), 'ltr', true)
    const pair = spreads.find((s) => s.left?.index === 11)
    // printed page 12 is spine index 11, printed 13 is index 12
    expect(pair).toBeDefined()
    expect(pair!.right?.index).toBe(12)
  })

  it('falls back to index parity with the cover alone', () => {
    const { sides, source } = assignSpreadSides(candidates(5), {
      pageList: new Map(), direction: 'ltr', modal: VIEWPORT,
    })
    expect(source).toBe('index-parity')
    expect(sides).toEqual(['center', 'left', 'right', 'left', 'right'])
  })

  it('ignores a page-list that labels too few pages', () => {
    const input = candidates(10)
    const pageList = new Map([['OEBPS/p0.xhtml', '1']])
    const { source } = assignSpreadSides(input, { pageList, direction: 'ltr', modal: VIEWPORT })
    expect(source).toBe('index-parity')
  })

  it('treats a double-width page as a pre-composed spread that stands alone', () => {
    const input = candidates(4)
    input[2] = { ...input[2]!, viewport: { width: 1600, height: 1200 } }
    const { sides } = assignSpreadSides(input, { pageList: new Map(), direction: 'ltr', modal: VIEWPORT })
    expect(sides[2]).toBe('center')
  })

  it('mirrors sides for right-to-left books', () => {
    const input = candidates(5)
    const pageList = new Map(input.map((c, i) => [c.path, String(i + 1)]))
    const ltr = assignSpreadSides(input, { pageList, direction: 'ltr', modal: VIEWPORT }).sides
    const rtl = assignSpreadSides(input, { pageList, direction: 'rtl', modal: VIEWPORT }).sides
    expect(rtl).toEqual(ltr.map((s) => (s === 'left' ? 'right' : s === 'right' ? 'left' : 'center')))
  })

  it('re-phases every pairing when the user shifts, leaving standalone pages alone', () => {
    const base = assignSpreadSides(candidates(6), { pageList: new Map(), direction: 'ltr', modal: VIEWPORT })
    const shifted = assignSpreadSides(candidates(6), {
      pageList: new Map(), direction: 'ltr', modal: VIEWPORT, shift: 1,
    })
    expect(base.sides).toEqual(['center', 'left', 'right', 'left', 'right', 'left'])
    expect(shifted.sides).toEqual(['center', 'right', 'left', 'right', 'left', 'right'])

    // The shift is what re-pairs a mispaired book.
    expect(buildSpreads(pagesFrom(base.sides), 'ltr', true).map((s) => [s.left?.index, s.right?.index]))
      .toEqual([[undefined, undefined], [1, 2], [3, 4], [5, undefined]])
    expect(buildSpreads(pagesFrom(shifted.sides), 'ltr', true).map((s) => [s.left?.index, s.right?.index]))
      .toEqual([[undefined, undefined], [undefined, 1], [2, 3], [4, 5]])
  })
})

describe('buildSpreads', () => {
  it('gives every page the whole frame when not pairing', () => {
    const spreads = buildSpreads(pagesFrom(['center', 'left', 'right']), 'ltr', false)
    expect(spreads.length).toBe(3)
    expect(spreads.every((s) => s.center !== undefined)).toBe(true)
  })

  it('places the reading-order-first page on the right in RTL books', () => {
    const spreads = buildSpreads(pagesFrom(['right', 'left']), 'rtl', true)
    expect(spreads.length).toBe(1)
    expect(spreads[0]!.right!.index).toBe(0)
    expect(spreads[0]!.left!.index).toBe(1)
  })

  it('lets an unpaired page face a blank rather than stealing its neighbour', () => {
    const spreads = buildSpreads(pagesFrom(['right', 'left', 'right']), 'ltr', true)
    expect(spreads.map((s) => [s.left?.index, s.right?.index])).toEqual([[undefined, 0], [1, 2]])
  })
})

describe('shouldPair', () => {
  const landscape = { width: 1280, height: 800 }
  const portrait = { width: 800, height: 1280 }

  it('pairs in landscape for landscape and auto policies, at any width', () => {
    expect(shouldPair('landscape', landscape)).toBe(true)
    expect(shouldPair('auto', landscape)).toBe(true)
    // Decision §16.4: no minimum per-page width gate — a small landscape phone still spreads.
    expect(shouldPair('landscape', { width: 740, height: 360 })).toBe(true)
  })

  it('never pairs in portrait, and never for rendition:spread none', () => {
    expect(shouldPair('landscape', portrait)).toBe(false)
    expect(shouldPair('auto', portrait)).toBe(false)
    expect(shouldPair('none', landscape)).toBe(false)
  })

  it('lets the user override the policy in both directions', () => {
    expect(shouldPair('none', landscape, 'double')).toBe(true)
    expect(shouldPair('both', landscape, 'single')).toBe(false)
  })
})
