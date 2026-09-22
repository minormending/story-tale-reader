/** Load an EPUB container into a fully-resolved ParsedBook. */

import { ZipArchive, type ByteSource } from '../zip/reader'
import { dirname, resolvePath } from '../path'
import { findPackagePath, detectDrm, DrmError } from './ocf'
import { parsePackageDocument, spineItems, hasMediaOverlays, type PackageDocument } from './opf'
import { addAltCounts, countAltText, EMPTY_ALT_COUNT } from './altText'
import { parseNavDocument, parseNcx, emptyNav, type NavDocument } from './nav'
import {
  detectLayout, layoutFromSpineProperties, parseSpreadPolicy, parseIbooksDisplayOptions,
} from '../layout/detect'
import {
  viewportFromDocument, primaryImageHref, imageSize, modalViewport, DEFAULT_VIEWPORT,
} from '../layout/viewport'
import { assignSpreadSides, type SpreadCandidate } from '../layout/spread'
import type {
  BookPage,
  LayoutOverrides,
  ParsedBook,
  ProgressReporter,
  Viewport,
} from '../types'

const IBOOKS_OPTIONS = 'META-INF/com.apple.ibooks.display-options.xml'
const CONTAINER = 'META-INF/container.xml'

/** How many spine documents to sample when the book declares no layout. */
const DETECTION_SAMPLE = 12

/** Pages measured between yields back to the event loop. */
const YIELD_EVERY = 4

/**
 * Hand the event loop back for one turn, so progress can be painted.
 *
 * Awaiting a zip read is not enough on its own. Over an in-memory buffer the read
 * resolves in a microtask, and microtasks all drain before the renderer gets a turn
 * — so a hundred awaited reads paint nothing, and the app looks frozen on exactly
 * the long load the progress exists to explain. A timeout is a macrotask, which
 * does yield.
 */
function yieldToPaint(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * What a previous open measured, and what this one measured.
 *
 * Measuring is the expensive half of opening a fixed-layout book: every page
 * document is read, and a page that declares no size of its own has its main
 * image's header decoded as well. None of it depends on anything but the file,
 * whose identity is a hash of its bytes — so the second open never has to repeat it.
 *
 * Deliberately the *raw* measurement, before any reader override is applied. An
 * override can be changed and changed back, and a cache holding the result rather
 * than the input would have to be invalidated on every such change.
 */
export interface LayoutMeasurement {
  /** Spine length this was measured against, so a mismatch discards it. */
  pageCount: number
  /** Share of sampled documents carrying a viewport, for layout detection. */
  viewportCoverage: number
  /** Per-page intrinsic sizes, positionally matched to the spine. */
  viewports: Array<Viewport | undefined>
}

export interface LoadOptions {
  /** A previous open's measurement, which makes measuring unnecessary. */
  cached?: LayoutMeasurement
  /**
   * Resolve every page's intrinsic size. Default true.
   *
   * Adding a book to the shelf does not need it: the entry keeps a title, an
   * author, a page count, a layout and a cover, and none of those depend on how big
   * any individual page is. Importing a folder of forty books would otherwise
   * measure every page of every one of them, most of which nobody is about to open.
   * The first open measures, and keeps the result.
   */
  measure?: boolean
}

export interface LoadedEpub {
  book: ParsedBook
  archive: ZipArchive
  /** Pass back to a later `loadEpub` to skip measuring entirely. */
  measurement: LayoutMeasurement
  pkg: PackageDocument
  nav: NavDocument
}

export async function loadEpub(
  source: ByteSource,
  overrides: LayoutOverrides = {},
  onProgress?: ProgressReporter,
  options: LoadOptions = {},
): Promise<LoadedEpub> {
  const report: ProgressReporter = onProgress ?? (() => {})

  report({ stage: 'unpacking' })
  const archive = await ZipArchive.open(source)

  report({ stage: 'inspecting' })
  const drm = await detectDrm(archive)
  if (drm) {
    throw new DrmError(
      `This book is encrypted (${drm}). Story Tale Reader does not remove DRM — ` +
        'open it in the app it was bought from, or use a DRM-free copy.',
    )
  }

  if (!archive.has(CONTAINER)) throw new Error('Not an EPUB: META-INF/container.xml is missing')
  const packagePath = findPackagePath(await archive.readText(CONTAINER)) ?? findLooseOpf(archive)
  if (!packagePath || !archive.has(packagePath)) {
    throw new Error('Not an EPUB: the package document could not be located')
  }

  const pkg = parsePackageDocument(await archive.readText(packagePath), packagePath)
  const nav = await loadNavigation(archive, pkg)

  const entries = spineItems(pkg)

  /* ----------------------- layout detection ----------------------- */

  let ibooksFixedLayout: boolean | undefined
  if (archive.has(IBOOKS_OPTIONS)) {
    ibooksFixedLayout = parseIbooksDisplayOptions(await archive.readText(IBOOKS_OPTIONS)).fixedLayout
  }

  const declaredLayout = pkg.meta.get('rendition:layout')
  const { cached, measure = true } = options
  const usable = cached && cached.pageCount === entries.length ? cached : undefined
  const needsSampling = !declaredLayout && !ibooksFixedLayout && !usable
  let viewportCoverage = usable?.viewportCoverage ?? 0
  if (needsSampling) {
    const sample = entries.slice(0, DETECTION_SAMPLE)
    let withViewport = 0
    for (const { item } of sample) {
      const xml = await safeReadText(archive, item.path)
      if (xml && viewportFromDocument(xml)) withViewport++
    }
    viewportCoverage = sample.length ? withViewport / sample.length : 0
  }

  const decision = detectLayout({
    renditionLayout: declaredLayout,
    ibooksFixedLayout,
    legacyFixedLayout: pkg.meta.get('fixed-layout')?.toLowerCase() === 'true',
    viewportCoverage,
    override: overrides.forceLayout,
  })

  /* ------------------------ per-page viewports ------------------------ */

  const viewports: Array<Viewport | undefined> = []
  if (decision.layout === 'pre-paginated') {
    const declaredViewport = parsePackageViewport(pkg)
    // Only this branch is slow, and only when the book declares no viewport of its
    // own: every page is read, and a page without a viewport meta has its main
    // image's header decoded as well.
    const fixed = overrides.viewportOverride ?? declaredViewport
    if (!fixed && !usable && !measure) {
      // Deferred: every page takes the book's default size for now, which is enough
      // to describe it on a shelf. Nothing is written to the cache, so the first
      // real open measures properly rather than inheriting these placeholders.
      for (let i = 0; i < entries.length; i++) viewports.push(undefined)
    } else {
      const measured = !fixed && !usable
      report({ stage: 'measuring', done: 0, total: entries.length })
      for (const [index, { item }] of entries.entries()) {
        viewports.push(fixed ?? usable?.viewports[index] ?? (await resolvePageViewport(archive, item.path)))
        if (!measured) continue
        report({ stage: 'measuring', done: index + 1, total: entries.length })
        if ((index + 1) % YIELD_EVERY === 0) await yieldToPaint()
      }
    }
  } else {
    for (let i = 0; i < entries.length; i++) viewports.push(undefined)
  }

  const modal =
    overrides.viewportOverride ??
    modalViewport(viewports.filter((v): v is Viewport => v !== undefined)) ??
    DEFAULT_VIEWPORT

  /* --------------------------- spread sides --------------------------- */

  const candidates: SpreadCandidate[] = entries.map(({ entry, item }, index) => ({
    index,
    path: item.path,
    properties: entry.properties,
    viewport: viewports[index] ?? modal,
  }))

  report({ stage: 'pairing' })
  const assignment = assignSpreadSides(candidates, {
    pageList: nav.pageList,
    direction: pkg.direction,
    modal,
    shift: overrides.spreadShift ?? 0,
  })

  const pages: BookPage[] = entries.map(({ entry, item }, index) => {
    const overlayId = item.mediaOverlayId
    const overlay = overlayId ? pkg.manifest.get(overlayId) : undefined
    return {
      index,
      id: item.id,
      path: item.path,
      viewport: viewports[index] ?? modal,
      spreadSide: assignment.sides[index] ?? 'center',
      printedPage: nav.pageList.get(item.path),
      linear: entry.linear,
      overlayPath: overlay?.path,
      // A per-page layout override is legal; the renderer honours it.
      layoutOverride: layoutFromSpineProperties(entry.properties),
    }
  })

  /*
   * Do the book's pictures carry any description? (docs/accessibility.md)
   *
   * Bounded to the same sample the layout detector uses, and skipped entirely on
   * the deferred path, because this runs while somebody is waiting for a book to
   * open and the honest answer for a long book is worth less than a fast open. The
   * note it feeds says how far it looked, so a partial answer never reads as a
   * complete one.
   */
  let altText = { ...EMPTY_ALT_COUNT, pagesChecked: 0, pageCount: entries.length }
  if (measure) {
    for (const [index, { item }] of entries.slice(0, DETECTION_SAMPLE).entries()) {
      const xml = await safeReadText(archive, item.path)
      if (xml) altText = { ...addAltCounts(altText, countAltText(xml)), pagesChecked: altText.pagesChecked + 1, pageCount: entries.length }
      if ((index + 1) % YIELD_EVERY === 0) await yieldToPaint()
    }
  }

  const book: ParsedBook = {
    format: 'epub',
    metadata: pkg.metadata,
    layout: decision.layout,
    layoutInferred: decision.inferred,
    spread: parseSpreadPolicy(pkg.meta.get('rendition:spread')),
    spreadSource: assignment.source,
    direction: pkg.direction,
    pages,
    nav: nav.toc,
    coverPath: pkg.coverPath,
    hasMediaOverlays: hasMediaOverlays(pkg),
    activeClass: pkg.meta.get('media:active-class') || undefined,
    packagePath,
    altText,
  }

  return {
    book,
    archive,
    pkg,
    nav,
    // The raw measurement, whether it came from the cache or was taken just now, so
    // a caller that had nothing to pass in has something to keep.
    measurement: {
      pageCount: entries.length,
      viewportCoverage,
      viewports:
        overrides.viewportOverride || !measure ? (usable?.viewports ?? []) : viewports,
    },
  }
}

function findLooseOpf(archive: ZipArchive): string | undefined {
  return archive.list().find((path) => path.toLowerCase().endsWith('.opf'))
}

async function loadNavigation(archive: ZipArchive, pkg: PackageDocument): Promise<NavDocument> {
  if (pkg.navPath && archive.has(pkg.navPath)) {
    const xml = await safeReadText(archive, pkg.navPath)
    if (xml) {
      const nav = parseNavDocument(xml, pkg.navPath)
      // Some EPUB 3 books keep the page-list only in a legacy NCX.
      if (nav.pageList.size === 0 && pkg.ncxPath && archive.has(pkg.ncxPath)) {
        const ncxXml = await safeReadText(archive, pkg.ncxPath)
        if (ncxXml) {
          const ncx = parseNcx(ncxXml, pkg.ncxPath)
          return { ...nav, pageList: ncx.pageList, toc: nav.toc.length ? nav.toc : ncx.toc }
        }
      }
      return nav
    }
  }
  if (pkg.ncxPath && archive.has(pkg.ncxPath)) {
    const xml = await safeReadText(archive, pkg.ncxPath)
    if (xml) return parseNcx(xml, pkg.ncxPath)
  }
  return emptyNav()
}

function parsePackageViewport(pkg: PackageDocument): Viewport | undefined {
  const declared = pkg.meta.get('rendition:viewport')
  if (!declared) return undefined
  const width = /width\s*=\s*([0-9.]+)/i.exec(declared)
  const height = /height\s*=\s*([0-9.]+)/i.exec(declared)
  if (!width || !height) return undefined
  return { width: Number.parseFloat(width[1]!), height: Number.parseFloat(height[1]!) }
}

/** Per-page viewport: the document's own declaration, else its primary image's size. */
async function resolvePageViewport(archive: ZipArchive, path: string): Promise<Viewport | undefined> {
  const xml = await safeReadText(archive, path)
  if (!xml) return undefined

  const declared = viewportFromDocument(xml)
  if (declared) return declared

  const href = primaryImageHref(xml)
  if (!href) return undefined

  const imagePath = resolvePath(dirname(path), href)
  if (!archive.has(imagePath)) return undefined
  try {
    return imageSize(await archive.read(imagePath))
  } catch {
    return undefined
  }
}

async function safeReadText(archive: ZipArchive, path: string): Promise<string | undefined> {
  try {
    return await archive.readText(path)
  } catch {
    return undefined
  }
}

export { DrmError }
