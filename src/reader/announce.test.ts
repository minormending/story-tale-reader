import { describe, it, expect } from 'vitest'
import { announceScreen, announceSpread } from './announce'
import type { BookPage } from '../engine/types'

const page = (over: Partial<BookPage> = {}): BookPage => ({
  index: 0,
  id: 'p',
  path: 'p.xhtml',
  viewport: { width: 1200, height: 1600 },
  spreadSide: 'center',
  linear: true,
  ...over,
})

describe('announceSpread', () => {
  it('says the numbers the book itself prints', () => {
    // What a grown-up means by "go back to page six" is the printed six, which in
    // a picture book is rarely the sixth file in the spine.
    const said = announceSpread([page({ printedPage: '6' }), page({ printedPage: '7' })], 3, 12)
    expect(said).toBe('Pages 6 and 7')
  })

  it('says one page singular', () => {
    expect(announceSpread([page({ printedPage: '6' })], 3, 12)).toBe('Page 6')
  })

  it('falls back to the position when the book prints no numbers', () => {
    expect(announceSpread([page(), page()], 3, 12)).toBe('Pages, 4 of 12')
    expect(announceSpread([page()], 0, 12)).toBe('Page 1 of 12')
  })

  it('does not mix printed and counted labels', () => {
    // Half a spread labelled is worse than none: "Pages 6 and 5 of 12" would be
    // read as a contradiction. Fall back wholesale instead.
    const said = announceSpread([page({ printedPage: '6' }), page()], 4, 12)
    expect(said).toBe('Pages, 5 of 12')
  })

  it('never says slash', () => {
    for (const said of [
      announceSpread([page()], 0, 3),
      announceSpread([page(), page()], 1, 3),
      announceSpread([page({ printedPage: 'vii' })], 1, 3),
    ]) {
      expect(said).not.toContain('/')
    }
  })

  it('reads a roman or worded label as printed', () => {
    expect(announceSpread([page({ printedPage: 'vii' })], 1, 30)).toBe('Page vii')
  })

  it('survives a spread with no pages at all', () => {
    // Briefly true while a book is loading, and an exception here would take the
    // reader down rather than lose an announcement.
    expect(() => announceSpread([], 0, 0)).not.toThrow()
  })
})

describe('announceScreen', () => {
  it('names the section only when asked', () => {
    expect(announceScreen(1, 5, 'Chapter One', true)).toBe('Chapter One. Screen 2 of 5')
    expect(announceScreen(1, 5, 'Chapter One', false)).toBe('Screen 2 of 5')
  })

  it('omits a section it does not have', () => {
    expect(announceScreen(0, 4, undefined, true)).toBe('Screen 1 of 4')
  })

  it('never claims zero screens', () => {
    // screenCount starts at 1 and is measured after layout; a book caught mid
    // measurement should not announce "screen 1 of 0".
    expect(announceScreen(0, 0, undefined, false)).toBe('Screen 1 of 1')
  })
})
