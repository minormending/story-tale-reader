import { describe, it, expect } from 'vitest'
import { addAltCounts, countAltText, EMPTY_ALT_COUNT } from './altText'

const doc = (body: string) =>
  `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body>${body}</body></html>`

describe('countAltText', () => {
  it('counts a described picture as described', () => {
    expect(countAltText(doc('<img src="a.png" alt="A robin on a slide"/>'))).toEqual({
      images: 1,
      described: 1,
      decorative: 0,
    })
  })

  it('counts a missing alt as undescribed', () => {
    expect(countAltText(doc('<img src="a.png"/>'))).toEqual({
      images: 1,
      described: 0,
      decorative: 0,
    })
  })

  it('treats an empty alt as an answer, not a failure', () => {
    // alt="" says "there is nothing here worth reading out". Counting it against
    // the book would punish exactly the publishers who did the work.
    expect(countAltText(doc('<img src="rule.png" alt=""/>'))).toEqual({
      images: 1,
      described: 0,
      decorative: 1,
    })
  })

  it('treats a presentational role the same way', () => {
    expect(countAltText(doc('<img src="r.png" role="presentation"/>')).decorative).toBe(1)
    expect(countAltText(doc('<img src="r.png" role="none"/>')).decorative).toBe(1)
  })

  it('does not count whitespace as a description', () => {
    expect(countAltText(doc('<img src="a.png" alt="   "/>'))).toEqual({
      images: 1,
      described: 0,
      decorative: 0,
    })
  })

  it('reads an SVG image, which is how a scanned page arrives', () => {
    const svg = doc(
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="p1.jpg"><title>Page one</title></image></svg>',
    )
    expect(countAltText(svg)).toEqual({ images: 1, described: 1, decorative: 0 })
  })

  it('does not accept an empty SVG title as a description', () => {
    const svg = doc(
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="p1.jpg"><title> </title></image></svg>',
    )
    expect(countAltText(svg)).toEqual({ images: 1, described: 0, decorative: 0 })
  })

  it('counts several pictures on one page', () => {
    const page = doc('<img alt="one"/><img/><img alt=""/><img alt="two"/>')
    expect(countAltText(page)).toEqual({ images: 4, described: 2, decorative: 1 })
  })

  it('returns nothing for markup it cannot parse, rather than throwing', () => {
    // A book that will not open because its accessibility could not be summarised
    // would be a poor trade.
    expect(countAltText('<<<not xml')).toEqual(EMPTY_ALT_COUNT)
    expect(countAltText('')).toEqual(EMPTY_ALT_COUNT)
  })

  it('finds pictures however deeply they are nested', () => {
    expect(countAltText(doc('<div><p><span><img alt="deep"/></span></p></div>')).images).toBe(1)
  })
})

describe('addAltCounts', () => {
  it('sums page by page', () => {
    const a = { images: 2, described: 1, decorative: 1 }
    const b = { images: 3, described: 3, decorative: 0 }
    expect(addAltCounts(a, b)).toEqual({ images: 5, described: 4, decorative: 1 })
  })

  it('leaves its inputs alone', () => {
    const a = { images: 1, described: 1, decorative: 0 }
    addAltCounts(a, a)
    expect(a).toEqual({ images: 1, described: 1, decorative: 0 })
  })
})
