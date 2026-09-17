/**
 * Spread pairing (SPEC.md §5.3) — the fix for the off-by-one spread bug.
 *
 * Most fixed-layout children's books ship no `page-spread-left`/`page-spread-right`
 * properties at all, so a reader has to work out which pages face each other. Readers
 * that jump straight to index parity mispair every spread in any book whose front
 * matter is an odd number of pages: art does not meet at the gutter and text lands on
 * the wrong illustration.
 *
 * Resolution order: explicit properties -> nav page-list parity -> page aspect ratio
 * -> index parity. Whatever we infer, §6.4's one-tap shift lets the reader correct it.
 */

import type {
  BookPage, Direction, Spread, SpreadPolicy, SpreadSide, Viewport,
} from '../types'

export interface SpreadCandidate {
  index: number
  /** Container-absolute path, used to look the page up in the nav page-list. */
  path: string
  /** Spine itemref properties. */
  properties: string[]
  viewport: Viewport
}

export type SideSource = 'explicit' | 'page-list' | 'index-parity'

export interface SideAssignment {
  sides: SpreadSide[]
  /** True where the page begins a new spread (the verso in a left-to-right book). */
  starts: boolean[]
  /** Which rule decided, surfaced in the UI so a wrong guess is explainable. */
  source: SideSource
}

/** A page ~1.5x the book's usual width is a pre-composed spread and stands alone. */
const WIDE_PAGE_RATIO = 1.5

/** Below this share of numerically-labelled pages, the page-list is not trustworthy. */
const PAGE_LIST_COVERAGE = 0.5

function explicitSide(properties: string[]): SpreadSide | undefined {
  for (const property of properties) {
    const value = property.toLowerCase()
    if (value.endsWith('page-spread-left')) return 'left'
    if (value.endsWith('page-spread-right')) return 'right'
    if (value.endsWith('page-spread-center')) return 'center'
  }
  return undefined
}

function arabic(label: string | undefined): number | undefined {
  if (!label) return undefined
  const match = /^\s*(\d+)\s*$/.exec(label)
  return match ? Number.parseInt(match[1]!, 10) : undefined
}

export function assignSpreadSides(
  pages: SpreadCandidate[],
  options: {
    pageList: Map<string, string>
    direction: Direction
    modal: Viewport
    shift?: 0 | 1
  },
): SideAssignment {
  const { pageList, direction, modal, shift = 0 } = options
  const count = pages.length
  const starts: boolean[] = new Array(count).fill(false)
  const centered: boolean[] = new Array(count).fill(false)

  const explicit = pages.map((page) => explicitSide(page.properties))
  const everyPageExplicit = explicit.every((side) => side !== undefined)

  // Rule 3 applies regardless of how sides are derived: a double-width page is a
  // pre-composed spread and can never share the frame.
  const wide = pages.map((page) => page.viewport.width >= modal.width * WIDE_PAGE_RATIO)

  let source: SideSource

  if (everyPageExplicit) {
    source = 'explicit'
    for (let i = 0; i < count; i++) {
      const side = explicit[i]!
      if (side === 'center' || wide[i]) centered[i] = true
      else starts[i] = direction === 'ltr' ? side === 'left' : side === 'right'
    }
  } else {
    // Rule 2: printed page numbers from the nav page-list.
    const numbers = pages.map((page) => arabic(pageList.get(page.path)))
    const labelled = numbers.filter((n) => n !== undefined).length
    const usePageList = count > 0 && labelled / count >= PAGE_LIST_COVERAGE

    if (usePageList) {
      source = 'page-list'
      let lastKnown = 0
      for (let i = 0; i < count; i++) {
        const printed = numbers[i] ?? ++lastKnown
        lastKnown = printed
        // A verso (even printed page) opens the spread.
        starts[i] = printed % 2 === 0
        if (wide[i]) centered[i] = true
      }
    } else {
      // Rule 4: index parity, with the first spine item standing alone as the cover.
      source = 'index-parity'
      for (let i = 0; i < count; i++) {
        if (i === 0 || wide[i]) centered[i] = true
        else starts[i] = (i - 1) % 2 === 0
      }
    }

    // Explicit values still win wherever a book bothered to provide them.
    for (let i = 0; i < count; i++) {
      const side = explicit[i]
      if (!side) continue
      if (side === 'center') { centered[i] = true; starts[i] = false }
      else { centered[i] = false; starts[i] = direction === 'ltr' ? side === 'left' : side === 'right' }
    }
  }

  // The user's one-tap correction: re-phase the pairing. Pages that stand alone are
  // left alone, so a cover stays a cover.
  if (shift === 1) {
    for (let i = 0; i < count; i++) if (!centered[i]) starts[i] = !starts[i]
  }

  const versoSide: SpreadSide = direction === 'ltr' ? 'left' : 'right'
  const rectoSide: SpreadSide = direction === 'ltr' ? 'right' : 'left'
  const sides = starts.map((isStart, i) => (centered[i] ? 'center' : isStart ? versoSide : rectoSide))

  return { sides, starts, source }
}

/** Whether the current frame should show two pages, per rendition:spread and overrides. */
export function shouldPair(
  policy: SpreadPolicy,
  frame: { width: number; height: number },
  mode: 'auto' | 'single' | 'double' = 'auto',
): boolean {
  if (mode === 'single') return false
  if (mode === 'double') return true

  const landscape = frame.width > frame.height
  switch (policy) {
    case 'none': return false
    case 'portrait': return !landscape
    case 'both': return true
    // Always pair in landscape — no minimum per-page width gate (SPEC.md §16.4).
    case 'landscape':
    case 'auto':
    default: return landscape
  }
}

/** Group pages into rendering units. In single mode every page fills the frame alone. */
export function buildSpreads(pages: BookPage[], direction: Direction, paired: boolean): Spread[] {
  const out: Spread[] = []

  if (!paired) {
    for (const page of pages) out.push({ index: out.length, center: page })
    return out
  }

  const opensSpread = (page: BookPage): boolean =>
    direction === 'ltr' ? page.spreadSide === 'left' : page.spreadSide === 'right'

  let i = 0
  while (i < pages.length) {
    const page = pages[i]!

    if (page.spreadSide === 'center') {
      out.push({ index: out.length, center: page })
      i += 1
      continue
    }

    const next = pages[i + 1]
    if (opensSpread(page) && next && next.spreadSide !== 'center' && !opensSpread(next)) {
      out.push(
        direction === 'ltr'
          ? { index: out.length, left: page, right: next }
          : { index: out.length, left: next, right: page },
      )
      i += 2
      continue
    }

    // A page whose partner is missing keeps its side and faces a blank.
    out.push(
      page.spreadSide === 'left'
        ? { index: out.length, left: page }
        : { index: out.length, right: page },
    )
    i += 1
  }

  return out
}

/** Index of the spread containing a given page, for restoring a reading position. */
export function spreadIndexOfPage(spreads: Spread[], pageIndex: number): number {
  for (const spread of spreads) {
    if (spread.center?.index === pageIndex) return spread.index
    if (spread.left?.index === pageIndex) return spread.index
    if (spread.right?.index === pageIndex) return spread.index
  }
  return 0
}
