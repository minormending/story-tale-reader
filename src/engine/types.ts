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

export interface BookMetadata {
  title: string
  creator?: string
  language?: string
  identifier?: string
  publisher?: string
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
  /** Container-absolute path of the package document, for resolving hrefs. */
  packagePath: string
}
