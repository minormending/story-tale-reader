/** The EPUB package document (.opf): metadata, manifest, spine. */

import { parseXml, findAll, findFirst, childrenNamed, attr, textContent } from '../xml'
import { dirname, resolvePath } from '../path'
import type { BookMetadata, Direction } from '../types'

export interface ManifestItem {
  id: string
  href: string
  /** Container-absolute path. */
  path: string
  mediaType: string
  properties: string[]
  /** Manifest id of this item's media-overlay SMIL document, if any. */
  mediaOverlayId?: string
}

export interface SpineEntry {
  idref: string
  linear: boolean
  properties: string[]
}

export interface PackageDocument {
  version: string
  packagePath: string
  baseDir: string
  metadata: BookMetadata
  /** Package-level `<meta property="...">` values, e.g. rendition:layout. */
  meta: Map<string, string>
  /** `<meta refines="#id" property="...">` values, keyed by bare id. */
  refines: Map<string, Map<string, string>>
  manifest: Map<string, ManifestItem>
  manifestByPath: Map<string, ManifestItem>
  spine: SpineEntry[]
  direction: Direction
  navPath?: string
  ncxPath?: string
  coverPath?: string
}

function splitProperties(value: string | undefined): string[] {
  return value ? value.trim().split(/\s+/).filter(Boolean) : []
}

export function parsePackageDocument(xml: string, packagePath: string): PackageDocument {
  const doc = parseXml(xml)
  const pkg = findFirst(doc, 'package')
  if (!pkg) throw new Error('Package document has no <package> element')

  const baseDir = dirname(packagePath)
  const version = attr(pkg, 'version') ?? '2.0'
  const uniqueIdRef = attr(pkg, 'unique-identifier')

  /* ---------------------------- metadata ---------------------------- */

  const metadataEl = findFirst(pkg, 'metadata')
  const meta = new Map<string, string>()
  const refines = new Map<string, Map<string, string>>()
  const collections: Array<{ id?: string; name: string }> = []

  if (metadataEl) {
    for (const m of childrenNamed(metadataEl, 'meta')) {
      const property = attr(m, 'property')
      const refinesRef = m.attrs['refines']
      const value = (textContent(m) || attr(m, 'content') || '').trim()

      // A collection is the one property whose own id matters: its type and the
      // book's position within it arrive as separate metas refining it.
      if (property === 'belongs-to-collection' && !refinesRef) {
        collections.push({ id: m.attrs['id'], name: value })
      }

      if (property && refinesRef) {
        const id = refinesRef.replace(/^#/, '')
        const bucket = refines.get(id) ?? new Map<string, string>()
        bucket.set(property, value)
        refines.set(id, bucket)
      } else if (property) {
        meta.set(property, value)
      } else {
        // EPUB 2 style: <meta name="cover" content="cover-image"/>
        const name = attr(m, 'name')
        if (name) meta.set(name, attr(m, 'content') ?? value)
      }
    }
  }

  const dc = (name: string): string | undefined => {
    const el = metadataEl ? childrenNamed(metadataEl, name)[0] : undefined
    const value = el ? textContent(el).trim() : ''
    return value || undefined
  }

  let identifier = dc('identifier')
  if (uniqueIdRef && metadataEl) {
    const match = childrenNamed(metadataEl, 'identifier').find((el) => el.attrs['id'] === uniqueIdRef)
    if (match) identifier = textContent(match).trim() || identifier
  }

  const metadata: BookMetadata = {
    title: dc('title') ?? 'Untitled',
    creator: dc('creator'),
    language: dc('language'),
    publisher: dc('publisher'),
    identifier,
  }

  /* ---------------------------- manifest ---------------------------- */

  const manifest = new Map<string, ManifestItem>()
  const manifestByPath = new Map<string, ManifestItem>()
  const manifestEl = findFirst(pkg, 'manifest')

  if (manifestEl) {
    for (const el of childrenNamed(manifestEl, 'item')) {
      const id = attr(el, 'id')
      const href = attr(el, 'href')
      if (!id || !href) continue
      const item: ManifestItem = {
        id,
        href,
        path: resolvePath(baseDir, href),
        mediaType: attr(el, 'media-type') ?? '',
        properties: splitProperties(attr(el, 'properties')),
        mediaOverlayId: attr(el, 'media-overlay') ?? undefined,
      }
      manifest.set(id, item)
      manifestByPath.set(item.path, item)
    }
  }

  /* ------------------------------ spine ------------------------------ */

  const spine: SpineEntry[] = []
  const spineEl = findFirst(pkg, 'spine')
  if (spineEl) {
    for (const el of childrenNamed(spineEl, 'itemref')) {
      const idref = attr(el, 'idref')
      if (!idref) continue
      spine.push({
        idref,
        linear: (attr(el, 'linear') ?? 'yes').toLowerCase() !== 'no',
        properties: splitProperties(attr(el, 'properties')),
      })
    }
  }

  const direction: Direction =
    (attr(spineEl ?? pkg, 'page-progression-direction') ?? '').toLowerCase() === 'rtl' ? 'rtl' : 'ltr'

  const ncxId = spineEl ? attr(spineEl, 'toc') : undefined
  const ncxPath = ncxId ? manifest.get(ncxId)?.path : undefined

  const navItem = [...manifest.values()].find((item) => item.properties.includes('nav'))

  /**
   * The series this book belongs to, if it says so.
   *
   * EPUB 3 states it as a collection refined with a type of "series" and the book's
   * position within it. Calibre, which is where most people's libraries come from,
   * predates that and writes EPUB 2 name/content metas instead — so both are read,
   * with the standard one preferred.
   */
  const declared = collections.find(
    (c) => c.id && refines.get(c.id)?.get('collection-type') === 'series',
  )
  const seriesName = declared?.name || meta.get('calibre:series') || undefined
  const seriesPosition =
    (declared?.id ? refines.get(declared.id)?.get('group-position') : undefined) ||
    meta.get('calibre:series_index') ||
    undefined

  if (seriesName) {
    metadata.series = seriesName
    const position = Number.parseFloat(seriesPosition ?? '')
    if (Number.isFinite(position)) metadata.seriesIndex = position
  }

  return {
    version,
    packagePath,
    baseDir,
    metadata,
    meta,
    refines,
    manifest,
    manifestByPath,
    spine,
    direction,
    navPath: navItem?.path,
    ncxPath,
    coverPath: findCover(manifest, meta),
  }
}

function findCover(manifest: Map<string, ManifestItem>, meta: Map<string, string>): string | undefined {
  const items = [...manifest.values()]

  // EPUB 3: properties="cover-image".
  const declared = items.find((item) => item.properties.includes('cover-image'))
  if (declared) return declared.path

  // EPUB 2: <meta name="cover" content="<manifest id>"/>.
  const legacyId = meta.get('cover')
  if (legacyId) {
    const item = manifest.get(legacyId)
    if (item?.mediaType.startsWith('image/')) return item.path
  }

  // Last resort: an image whose id or filename says "cover".
  return items.find(
    (item) => item.mediaType.startsWith('image/') && /cover/i.test(`${item.id} ${item.href}`),
  )?.path
}

/** Spine entries joined to their manifest items, skipping dangling idrefs. */
export function spineItems(pkg: PackageDocument): Array<{ entry: SpineEntry; item: ManifestItem }> {
  const out: Array<{ entry: SpineEntry; item: ManifestItem }> = []
  for (const entry of pkg.spine) {
    const item = pkg.manifest.get(entry.idref)
    if (item) out.push({ entry, item })
  }
  return out
}

/** All media-overlay SMIL paths referenced by the manifest. */
export function hasMediaOverlays(pkg: PackageDocument): boolean {
  for (const item of pkg.manifest.values()) if (item.mediaOverlayId) return true
  return false
}

export { findAll, attr }
