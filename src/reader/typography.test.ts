import { describe, it, expect } from 'vitest'
import { DEFAULT_TYPOGRAPHY, reflowableStyles } from './typography'

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
