import { describe, it, expect } from 'vitest'
import { DEFAULT_TYPOGRAPHY, RATES, asRate, asTypography, reflowableStyles } from './typography'

const frame = { width: 800, height: 600 }

/**
 * The spacing controls, tested where their effect actually lives.
 *
 * A UI check can see the control and that it responds, but not what it does to the
 * page: the text is inside an iframe, and a stylesheet is not a thing a screenshot
 * can read. This is the seam where the setting becomes CSS.
 */
describe('reflowableStyles spacing', () => {
  it('adds nothing when the reader has not asked for it', () => {
    const css = reflowableStyles(frame, DEFAULT_TYPOGRAPHY)
    expect(css).not.toContain('letter-spacing')
    expect(css).not.toContain('word-spacing')
  })

  it('sets both spacings in em, so they scale with the type size', () => {
    const css = reflowableStyles(frame, {
      ...DEFAULT_TYPOGRAPHY,
      letterSpacing: 0.12,
      wordSpacing: 0.18,
    })
    expect(css).toContain('letter-spacing: 0.12em !important')
    expect(css).toContain('word-spacing: 0.18em !important')
  })

  it('applies to the publisher’s own elements, not just the body', () => {
    // The body's text nodes are rarely where the words are — a book puts them in
    // paragraphs, and a rule on the body alone would leave those untouched.
    const css = reflowableStyles(frame, { ...DEFAULT_TYPOGRAPHY, letterSpacing: 0.06 })
    const descendants = css.slice(css.indexOf('body *:not(code):not(pre)'))
    expect(descendants).toContain('letter-spacing: 0.06em !important')
  })

  it('leaves code and preformatted text alone, where spacing carries meaning', () => {
    const css = reflowableStyles(frame, { ...DEFAULT_TYPOGRAPHY, letterSpacing: 0.12 })
    expect(css).toContain('body *:not(code):not(pre)')
  })
})

describe('asTypography', () => {
  it('takes a whole stored set at its word', () => {
    const stored = {
      fontScale: 1.45,
      lineHeight: 1.8,
      margin: 48,
      letterSpacing: 0.06,
      wordSpacing: 0.09,
      font: 'serif',
      theme: 'sepia',
    }
    expect(asTypography(stored)).toEqual(stored)
  })

  it('falls back field by field, keeping the ones that survived', () => {
    // A reader who had set a comfortable size should not lose it because a later
    // version renamed a theme.
    const out = asTypography({ fontScale: 1.45, theme: 'lagoon', font: 'comic' })
    expect(out.fontScale).toBe(1.45)
    expect(out.theme).toBe(DEFAULT_TYPOGRAPHY.theme)
    expect(out.font).toBe(DEFAULT_TYPOGRAPHY.font)
  })

  it('clamps rather than rejects a number outside the menu', () => {
    // Out of range is still an intention; an unclamped fontScale is a book at 40em.
    expect(asTypography({ fontScale: 99 }).fontScale).toBe(2.4)
    expect(asTypography({ fontScale: -5 }).fontScale).toBe(0.8)
    expect(asTypography({ letterSpacing: 10 }).letterSpacing).toBe(0.2)
  })

  it('refuses values that are not numbers at all', () => {
    for (const junk of [NaN, Infinity, '1.4', null, {}]) {
      expect(asTypography({ fontScale: junk }).fontScale).toBe(DEFAULT_TYPOGRAPHY.fontScale)
    }
  })

  it('returns the defaults for nothing at all', () => {
    expect(asTypography(undefined)).toEqual(DEFAULT_TYPOGRAPHY)
    expect(asTypography(null)).toEqual(DEFAULT_TYPOGRAPHY)
  })
})

describe('asRate', () => {
  it('accepts the rates the menu offers', () => {
    for (const rate of RATES) expect(asRate(rate)).toBe(rate)
  })

  it('refuses anything else, including plausible-looking speeds', () => {
    for (const junk of [0, 2, 1.5, '1', null, undefined, NaN]) expect(asRate(junk)).toBe(1)
  })
})
