import type { AltTextEvidence } from './epub/altText'

/** Shared engine types. Nothing here imports a UI framework. */

export type LayoutMode = 'pre-paginated' | 'reflowable'
export type SpreadPolicy = 'none' | 'landscape' | 'portrait' | 'both' | 'auto'
export type SpreadSide = 'left' | 'right' | 'center'
export type Direction = 'ltr' | 'rtl'
export type BookFormat = 'epub' | 'pdf' | 'mobi'

export interface Viewport {
  width: number
  height: number
}

/**
 * What a book says about its own accessibility (EPUB Accessibility 1.1).
 *
 * Publishers declare this so a reader can answer "will this work for my child?"
 * before opening it. Recorded verbatim rather than interpreted here — these are
 * claims, and the reader checks the most falsifiable of them against the pages.
 */
export interface BookAccessibility {
  /** schema:accessibilityFeature — alternativeText, synchronizedAudioText, ... */
  features: string[]
  /** schema:accessibilityHazard — flashing, motionSimulation, sound, or none. */
  hazards: string[]
  /** schema:accessMode — the senses the content is expressed in. */
  accessModes: string[]
  /** schema:accessibilitySummary — the publisher's own prose, if offered. */
  summary?: string
}

export interface BookMetadata {
  title: string
  creator?: string
  language?: string
  identifier?: string
  publisher?: string
  /** Series the book declares itself part of, if any. */
  series?: string
  /** Its position within that series, when stated. */
  seriesIndex?: number
  /** What the book claims about its own accessibility. */
  accessibility?: BookAccessibility
}

export interface NavItem {
  label: string
  href: string
  path: string
  fragment: string
  children: NavItem[]
}

/** One spine document, resolved and ready to render. */
export interface BookPage {
  index: number
  id: string
  /** Container-absolute path to the content document. */
  path: string
  viewport: Viewport
  spreadSide: SpreadSide
  /** Printed page label from the nav page-list, when the book provides one. */
  printedPage?: string
  linear: boolean
  overlayPath?: string
  /** Per-page layout override from the spine itemref's properties. */
  layoutOverride?: LayoutMode
}

/** A rendering unit: one page, or two facing pages shown together. */
export interface Spread {
  index: number
  left?: BookPage
  right?: BookPage
  /** A page that occupies the whole frame alone (cover, or a pre-composed spread). */
  center?: BookPage
}

export interface LayoutOverrides {
  forceLayout?: LayoutMode
  /** Flip every left/right assignment — the one-tap fix for mispaired spreads (SPEC.md §6.4). */
  spreadShift?: 0 | 1
  spreadMode?: 'auto' | 'single' | 'double'
  viewportOverride?: Viewport
}

export interface ParsedBook {
  format: BookFormat
  metadata: BookMetadata
  layout: LayoutMode
  /** True when layout was inferred rather than declared — surfaced in the UI. */
  layoutInferred: boolean
  spread: SpreadPolicy
  /** Which rule decided the spread pairing — shown in the UI so a wrong guess is explainable. */
  spreadSource: 'explicit' | 'page-list' | 'index-parity'
  direction: Direction
  pages: BookPage[]
  nav: NavItem[]
  coverPath?: string
  hasMediaOverlays: boolean
  /**
   * What a bounded sample of the pages showed about picture descriptions.
   *
   * `pagesChecked: 0` means the question was not asked, not that the answer was
   * no — the deferred open path skips it.
   */
  altText?: AltTextEvidence
  /** `media:active-class` — the class a book styles its spoken word with. */
  activeClass?: string
  /** Container-absolute path of the package document, for resolving hrefs. */
  packagePath: string
}

/**
 * Coarse stages of opening a book, for progress reporting.
 *
 * Opening a picture book is not instant: a fixed-layout book has its page sizes
 * resolved one document at a time, which for a hundred-page book means a hundred
 * reads and, where a page declares no viewport, an image header decode as well. The
 * reader reports where it has got to rather than showing a frozen name.
 */
export type LoadStage =
  | 'reading'    // getting the bytes, and fingerprinting them
  | 'unpacking'  // opening the archive
  | 'inspecting' // container, package document, navigation
  | 'measuring'  // per-page viewports: the long one, and countable
  | 'pairing'    // deciding which pages face each other
  | 'saving'     // writing to the shelf

export interface LoadProgress {
  stage: LoadStage
  /** Completed and total units, for the stages that have countable work. */
  done?: number
  total?: number
}

export type ProgressReporter = (progress: LoadProgress) => void
