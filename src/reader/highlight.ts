/**
 * How hard the spoken word is to miss.
 *
 * The reader adds and removes the book's own `media:active-class` and lets the
 * publisher's stylesheet decide what that looks like (SPEC.md §7.1), which is the
 * right default: the book was designed, and a reader that repaints it is guessing.
 *
 * But it means a book that styles its highlight faintly gets a faint result, and
 * eye-tracking of pre-K children found they spend **82%** of fixations on the
 * pictures and only **16%** on the text — where about half of those text fixations
 * coincided with the synchronised cue. A highlight that is easy to miss is doing
 * very little of the work it exists for. This is the override for that case, and
 * it stays an override: nothing here changes a book until somebody asks.
 */

export type HighlightStrength = 'book' | 'strong'

export const HIGHLIGHT_STRENGTHS: readonly HighlightStrength[] = ['book', 'strong']

export const HIGHLIGHT_LABELS: Record<HighlightStrength, string> = {
  book: "The book's own",
  strong: 'Stronger',
}

export const DEFAULT_HIGHLIGHT: HighlightStrength = 'book'

export function asHighlightStrength(value: unknown): HighlightStrength {
  return HIGHLIGHT_STRENGTHS.includes(value as HighlightStrength)
    ? (value as HighlightStrength)
    : DEFAULT_HIGHLIGHT
}

/**
 * Amber block, near-black ink — the pairing the interface already uses for its
 * own selected state, measured at about 11:1.
 *
 * Both properties are forced. The point of asking for this is that the book's own
 * styling was not enough, so a rule that the book can out-specify would be no
 * answer at all; and setting the background without the colour would leave the
 * publisher's own ink on it, which for a book that highlights by turning the word
 * white is unreadable.
 */
const STRONG_RULES = 'background: #ffb454 !important; color: #2a1c05 !important; border-radius: 0.2em;'

/** The gentle fallback, used only for a book that styles the class not at all. */
const FALLBACK_RULES = 'background: rgba(255, 180, 84, 0.45); border-radius: 0.2em;'

/**
 * The stylesheet to put in a page, or nothing when the book should be left alone.
 *
 * `definesOwn` is what the book's stylesheets say, so the three cases stay
 * separable: leave a styled book alone, help an unstyled one, and override either
 * on request.
 */
export function highlightCss(
  activeClass: string,
  strength: HighlightStrength,
  definesOwn: boolean,
): string | undefined {
  const escaped = escapeClass(activeClass)
  if (strength === 'strong') return `.${escaped} { ${STRONG_RULES} }`
  if (definesOwn) return undefined
  return `.${escaped} { ${FALLBACK_RULES} }`
}

/**
 * `CSS.escape` where it exists, a conservative fallback where it does not.
 *
 * The class name comes out of the book's own OPF, so it is publisher input going
 * into a selector. `CSS.escape` is missing from some of the older Android WebViews
 * this targets (SPEC.md §9.3), and on those a class name is better dropped than
 * concatenated raw.
 */
function escapeClass(name: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(name)

  const escaped = name.replace(/[^a-zA-Z0-9_-]/g, '\\$&')

  /*
   * A leading digit needs a hex escape, not a backslash.
   *
   * `.2hot` is not a valid selector and the whole rule is dropped, so the
   * highlight would silently do nothing. Backslashing the digit does not help
   * either — CSS reads `\2hot` as a code point. The trailing space terminates the
   * hex escape and is part of it, not decoration.
   *
   * Worth the four lines: this branch only runs where `CSS.escape` is missing,
   * which is the older Android WebViews this reader is for (SPEC.md §9.3), so the
   * devices least able to spare a broken highlight are the ones that would get it.
   */
  const first = escaped[0]
  if (first && first >= '0' && first <= '9') {
    return `\\3${first} ${escaped.slice(1)}`
  }
  return escaped
}
