import { describe, it, expect } from 'vitest'
import { asHighlightStrength, DEFAULT_HIGHLIGHT, highlightCss } from './highlight'

describe('asHighlightStrength', () => {
  it('takes a stored value at its word', () => {
    expect(asHighlightStrength('book')).toBe('book')
    expect(asHighlightStrength('strong')).toBe('strong')
  })

  it('falls back rather than trusting storage', () => {
    for (const junk of [undefined, null, '', 'STRONG', 2, {}]) {
      expect(asHighlightStrength(junk)).toBe(DEFAULT_HIGHLIGHT)
    }
  })

  it("defaults to leaving the book alone", () => {
    expect(DEFAULT_HIGHLIGHT).toBe('book')
  })
})

describe('highlightCss', () => {
  it('leaves a book that styles its own highlight alone', () => {
    expect(highlightCss('-epub-media-overlay-active', 'book', true)).toBeUndefined()
  })

  it('helps a book that styles nothing', () => {
    const css = highlightCss('-epub-media-overlay-active', 'book', false)
    expect(css).toContain('.-epub-media-overlay-active')
    expect(css).toContain('background')
    // The gentle fallback is translucent, so the publisher's artwork shows through.
    expect(css).toContain('rgba')
  })

  it('overrides a book that styles its own, when asked', () => {
    // The whole reason to ask for this is that the book's own styling was not
    // enough, so a rule the book can out-specify would be no answer at all.
    const css = highlightCss('active', 'strong', true)
    expect(css).toContain('!important')
    expect(css).toContain('#ffb454')
  })

  it('forces the ink as well as the fill', () => {
    // A book that highlights by turning the word white would be unreadable on the
    // amber block if only the background were replaced.
    const css = highlightCss('active', 'strong', false)
    expect(css).toMatch(/color:\s*#2a1c05\s*!important/)
  })

  it('escapes a class name, which comes from the book', () => {
    // The name is publisher input going into a selector.
    const css = highlightCss('bad class"name', 'strong', false)
    expect(css).not.toContain('bad class"name')
  })

  it('keeps a leading-digit class from forming a bare selector', () => {
    const css = highlightCss('2hot', 'strong', false)
    expect(css?.startsWith('.2hot')).toBe(false)
  })
})
