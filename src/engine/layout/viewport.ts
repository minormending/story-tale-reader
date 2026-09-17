/**
 * Viewport resolution (SPEC.md §5.2).
 *
 * A fixed-layout page declares the coordinate space its absolute positioning was
 * authored against. Getting this wrong is what collapses the layout, so we try
 * every source the format allows before falling back.
 */

import { parseXml, findAll, findFirst, attr } from '../xml'
import type { Viewport } from '../types'

/** Parse `width=800, height=1200` (also accepts `width=800px` and semicolons). */
export function parseViewportMeta(content: string): Viewport | undefined {
  const width = /(?:^|[\s,;])width\s*=\s*([0-9.]+)/i.exec(content)
  const height = /(?:^|[\s,;])height\s*=\s*([0-9.]+)/i.exec(content)
  if (!width || !height) return undefined
  const w = Number.parseFloat(width[1]!)
  const h = Number.parseFloat(height[1]!)
  return isUsable(w, h) ? { width: w, height: h } : undefined
}

function isUsable(w: number, h: number): boolean {
  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0
}

/**
 * Viewport declared by a content document: the meta viewport, or an SVG root's
 * viewBox / width+height for image-only pages.
 */
export function viewportFromDocument(xml: string): Viewport | undefined {
  const doc = parseXml(xml)

  for (const meta of findAll(doc, 'meta')) {
    if ((attr(meta, 'name') ?? '').toLowerCase() !== 'viewport') continue
    const parsed = parseViewportMeta(attr(meta, 'content') ?? '')
    if (parsed) return parsed
  }

  const svg = findFirst(doc, 'svg')
  if (svg) {
    const viewBox = attr(svg, 'viewBox')
    if (viewBox) {
      const parts = viewBox.trim().split(/[\s,]+/).map(Number)
      if (parts.length === 4 && isUsable(parts[2]!, parts[3]!)) {
        return { width: parts[2]!, height: parts[3]! }
      }
    }
    const w = Number.parseFloat(attr(svg, 'width') ?? '')
    const h = Number.parseFloat(attr(svg, 'height') ?? '')
    if (isUsable(w, h)) return { width: w, height: h }
  }

  return undefined
}

/** The path of the first/largest image referenced by a content document. */
export function primaryImageHref(xml: string): string | undefined {
  const doc = parseXml(xml)
  for (const img of findAll(doc, 'img')) {
    const src = attr(img, 'src')
    if (src) return src
  }
  for (const image of findAll(doc, 'image')) {
    const href = attr(image, 'href')
    if (href) return href
  }
  return undefined
}

/**
 * Intrinsic pixel size from an image's header bytes.
 *
 * Done by sniffing rather than by decoding so the engine stays usable outside a
 * browser and viewport resolution never has to wait on image loading.
 */
export function imageSize(bytes: Uint8Array): Viewport | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  // PNG: 8-byte signature, then an IHDR chunk with width/height as big-endian u32.
  if (bytes.byteLength > 24 && view.getUint32(0, false) === 0x89504e47) {
    return { width: view.getUint32(16, false), height: view.getUint32(20, false) }
  }

  // GIF: "GIF8", logical screen descriptor is little-endian.
  if (bytes.byteLength > 10 && view.getUint32(0, false) === 0x47494638) {
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) }
  }

  // JPEG: walk the marker segments to the frame header.
  if (bytes.byteLength > 4 && view.getUint16(0, false) === 0xffd8) {
    let offset = 2
    while (offset + 9 < bytes.byteLength) {
      if (view.getUint8(offset) !== 0xff) { offset++; continue }
      const marker = view.getUint8(offset + 1)
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue }
      if (marker === 0xd9 || marker === 0xda) break
      const length = view.getUint16(offset + 2, false)
      const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
      if (isFrame) {
        return { width: view.getUint16(offset + 7, false), height: view.getUint16(offset + 5, false) }
      }
      offset += 2 + length
    }
    return undefined
  }

  // WebP: RIFF container with VP8 / VP8L / VP8X payloads.
  if (bytes.byteLength > 30 && view.getUint32(0, false) === 0x52494646 && view.getUint32(8, false) === 0x57454250) {
    const chunk = view.getUint32(12, false)
    if (chunk === 0x56503858 /* VP8X */) {
      const w = 1 + (view.getUint8(24) | (view.getUint8(25) << 8) | (view.getUint8(26) << 16))
      const h = 1 + (view.getUint8(27) | (view.getUint8(28) << 8) | (view.getUint8(29) << 16))
      return { width: w, height: h }
    }
    if (chunk === 0x56503820 /* VP8  */) {
      return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff }
    }
    if (chunk === 0x5650384c /* VP8L */) {
      const bits = view.getUint32(21, true)
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
    }
  }

  return undefined
}

/** The most common viewport in a book — the sane default for pages that declare none. */
export function modalViewport(viewports: Viewport[]): Viewport | undefined {
  if (viewports.length === 0) return undefined
  const counts = new Map<string, { viewport: Viewport; count: number }>()
  for (const viewport of viewports) {
    const key = `${viewport.width}x${viewport.height}`
    const existing = counts.get(key)
    if (existing) existing.count++
    else counts.set(key, { viewport, count: 1 })
  }
  let best: { viewport: Viewport; count: number } | undefined
  for (const candidate of counts.values()) {
    if (!best || candidate.count > best.count) best = candidate
  }
  return best?.viewport
}

/** Last-resort viewport when a book declares nothing at all (SPEC.md §5.2 step 5). */
export const DEFAULT_VIEWPORT: Viewport = { width: 1200, height: 1600 }
