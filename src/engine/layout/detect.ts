/** Fixed-layout detection (SPEC.md §5.1). */

import { parseXml, findAll, attr, textContent } from '../xml'
import type { LayoutMode, SpreadPolicy } from '../types'

export interface LayoutSignals {
  /** OPF `<meta property="rendition:layout">`. */
  renditionLayout?: string
  /** META-INF/com.apple.ibooks.display-options.xml `<option name="fixed-layout">`. */
  ibooksFixedLayout?: boolean
  /** Legacy Kindle `<meta name="fixed-layout" content="true">`. */
  legacyFixedLayout?: boolean
  /** Share of sampled spine documents that declare an explicit pixel viewport. */
  viewportCoverage: number
  override?: LayoutMode
}

/** A book is treated as fixed-layout when most of its pages declare a viewport. */
export const VIEWPORT_COVERAGE_THRESHOLD = 0.8

export interface LayoutDecision {
  layout: LayoutMode
  /** True when nothing in the book declared the layout and we inferred it. */
  inferred: boolean
}

export function detectLayout(signals: LayoutSignals): LayoutDecision {
  if (signals.override) return { layout: signals.override, inferred: false }

  const declared = (signals.renditionLayout ?? '').trim().toLowerCase()
  if (declared === 'pre-paginated') return { layout: 'pre-paginated', inferred: false }
  if (declared === 'reflowable') return { layout: 'reflowable', inferred: false }

  if (signals.ibooksFixedLayout) return { layout: 'pre-paginated', inferred: false }
  if (signals.legacyFixedLayout) return { layout: 'pre-paginated', inferred: false }

  if (signals.viewportCoverage >= VIEWPORT_COVERAGE_THRESHOLD) {
    return { layout: 'pre-paginated', inferred: true }
  }

  return { layout: 'reflowable', inferred: false }
}

/** Per-page override from a spine itemref's properties. */
export function layoutFromSpineProperties(properties: string[]): LayoutMode | undefined {
  for (const property of properties) {
    const value = property.toLowerCase()
    if (value.endsWith('layout-pre-paginated')) return 'pre-paginated'
    if (value.endsWith('layout-reflowable')) return 'reflowable'
  }
  return undefined
}

export function parseSpreadPolicy(value: string | undefined): SpreadPolicy {
  switch ((value ?? '').trim().toLowerCase()) {
    case 'none': return 'none'
    case 'landscape': return 'landscape'
    case 'portrait': return 'portrait'
    case 'both': return 'both'
    default: return 'auto'
  }
}

/** Apple's legacy fixed-layout flag, still the only signal in some older books. */
export function parseIbooksDisplayOptions(xml: string): { fixedLayout?: boolean } {
  const doc = parseXml(xml)
  for (const option of findAll(doc, 'option')) {
    if ((attr(option, 'name') ?? '').toLowerCase() !== 'fixed-layout') continue
    return { fixedLayout: textContent(option).trim().toLowerCase() === 'true' }
  }
  return {}
}
