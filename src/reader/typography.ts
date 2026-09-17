/** Reader typography for reflowable books (SPEC.md §5.5). */

export type ReaderTheme = 'publisher' | 'paper' | 'sepia' | 'night'
export type ReaderFont = 'publisher' | 'serif' | 'sans'

export interface Typography {
  /** Multiplier on the base 16px body size. */
  fontScale: number
  lineHeight: number
  font: ReaderFont
  theme: ReaderTheme
  /** Page margin in CSS pixels. */
  margin: number
}

export const DEFAULT_TYPOGRAPHY: Typography = {
  fontScale: 1.15,
  lineHeight: 1.6,
  font: 'publisher',
  theme: 'publisher',
  margin: 36,
}

const THEMES: Record<Exclude<ReaderTheme, 'publisher'>, { bg: string; fg: string; link: string }> = {
  paper: { bg: '#ffffff', fg: '#16151a', link: '#1a4fd0' },
  sepia: { bg: '#f6ecd9', fg: '#3b2f21', link: '#7a4a12' },
  night: { bg: '#15141a', fg: '#e6e2ee', link: '#ffb454' },
}

const FONT_STACKS: Record<Exclude<ReaderFont, 'publisher'>, string> = {
  serif: 'Georgia, "Iowan Old Style", "Times New Roman", serif',
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
}

/** Longest comfortable line, in multiples of the body font size (~65 characters). */
const MAX_MEASURE_EM = 34

/**
 * The stylesheet injected into a reflowable page.
 *
 * Pagination is CSS multi-column: the body is exactly one frame wide, holding one
 * column, so each further column sits exactly one frame to the right and paging is a
 * single whole-frame translation. That only holds if the column pitch equals the
 * frame width, so the gap is always `frame.width - columnWidth` and the padding half
 * of it — which conveniently also centres the text.
 *
 * On a wide tablet the column is capped to a readable measure rather than letting a
 * line run the full 1200px.
 */
export function reflowableStyles(
  frame: { width: number; height: number },
  typography: Typography,
): string {
  const { margin, fontScale, lineHeight, font, theme } = typography
  const fontSize = Math.round(16 * fontScale)
  const columnWidth = Math.max(
    Math.min(frame.width - margin * 2, fontSize * MAX_MEASURE_EM),
    120,
  )
  const gutter = Math.max(Math.round((frame.width - columnWidth) / 2), 0)
  const palette = theme === 'publisher' ? undefined : THEMES[theme]
  const stack = font === 'publisher' ? undefined : FONT_STACKS[font]

  return `
    html {
      overflow: hidden !important;
      height: ${frame.height}px !important;
      width: ${frame.width}px !important;
      -webkit-text-size-adjust: none;
      ${palette ? `background: ${palette.bg} !important;` : ''}
    }
    body {
      margin: 0 !important;
      padding: ${margin}px ${gutter}px !important;
      width: ${frame.width}px !important;
      height: ${frame.height}px !important;
      box-sizing: border-box !important;
      column-width: ${columnWidth}px !important;
      column-gap: ${gutter * 2}px !important;
      column-fill: auto !important;
      font-size: ${fontSize}px !important;
      line-height: ${lineHeight} !important;
      ${stack ? `font-family: ${stack} !important;` : ''}
      ${palette ? `background: ${palette.bg} !important; color: ${palette.fg} !important;` : ''}
    }
    ${
      palette
        ? `body *:not(a):not(code):not(pre) { color: inherit !important; background-color: transparent !important; }
           body a { color: ${palette.link} !important; }`
        : ''
    }
    ${stack ? 'body *:not(code):not(pre) { font-family: inherit !important; }' : ''}
    /* Keep figures inside one column instead of forcing a blank page. */
    img, svg, video {
      max-width: 100% !important;
      max-height: ${Math.max(frame.height - margin * 2, 80)}px !important;
      height: auto !important;
      object-fit: contain;
    }
    /* Column layout cannot break inside a floated or absolutely positioned box. */
    * { float: none !important; }
    body > * { position: static !important; }
  `
}

/** Number of screens a laid-out document occupies. */
export function screenCount(body: HTMLElement, frameWidth: number): number {
  if (frameWidth <= 0) return 1
  return Math.max(1, Math.round(body.scrollWidth / frameWidth))
}
