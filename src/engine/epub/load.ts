/** Load an EPUB container into a fully-resolved ParsedBook. */

import { ZipArchive, type ByteSource } from '../zip/reader'
import { dirname, resolvePath } from '../path'
import { findPackagePath, detectDrm, DrmError } from './ocf'
import { parsePackageDocument, spineItems, hasMediaOverlays, type PackageDocument } from './opf'
import { parseNavDocument, parseNcx, emptyNav, type NavDocument } from './nav'
import {
  detectLayout, layoutFromSpineProperties, parseSpreadPolicy, parseIbooksDisplayOptions,
} from '../layout/detect'
import {
  viewportFromDocument, primaryImageHref, imageSize, modalViewport, DEFAULT_VIEWPORT,
} from '../layout/viewport'
import { assignSpreadSides, type SpreadCandidate } from '../layout/spread'
import type { BookPage, LayoutOverrides, ParsedBook, Viewport } from '../types'

const IBOOKS_OPTIONS = 'META-INF/com.apple.ibooks.display-options.xml'
const CONTAINER = 'META-INF/container.xml'

/** How many spine documents to sample when the book declares no layout. */
const DETECTION_SAMPLE = 12

export interface LoadedEpub {
  book: ParsedBook
  archive: ZipArchive
  pkg: PackageDocument
  nav: NavDocument
}

export async function loadEpub(source: ByteSource, overrides: LayoutOverrides = {}): Promise<LoadedEpub> {
  const archive = await ZipArchive.open(source)

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
  const needsSampling = !declaredLayout && !ibooksFixedLayout
  let viewportCoverage = 0
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
    for (const { item } of entries) {
      viewports.push(
        overrides.viewportOverride ??
          declaredViewport ??
          (await resolvePageViewport(archive, item.path)),
      )
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
  }

  return { book, archive, pkg, nav }
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
