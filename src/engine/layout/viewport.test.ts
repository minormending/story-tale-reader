import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import {
  parseViewportMeta, viewportFromDocument, primaryImageHref, imageSize, modalViewport,
} from './viewport'
import { ZipArchive, bufferSource } from '../zip/reader'

describe('parseViewportMeta', () => {
  it('parses the common forms', () => {
    expect(parseViewportMeta('width=800, height=1200')).toEqual({ width: 800, height: 1200 })
    expect(parseViewportMeta('width=800px; height=1200px')).toEqual({ width: 800, height: 1200 })
    expect(parseViewportMeta('height=1200,width=800')).toEqual({ width: 800, height: 1200 })
  })

  it('rejects reflowable-style viewports that carry no pixel size', () => {
    expect(parseViewportMeta('width=device-width, initial-scale=1')).toBeUndefined()
    expect(parseViewportMeta('width=0, height=0')).toBeUndefined()
  })

  it('does not match width inside another token', () => {
    expect(parseViewportMeta('minwidth=800, height=1200')).toBeUndefined()
  })
})

describe('viewportFromDocument', () => {
  it('reads a meta viewport', () => {
    const xml = '<html><head><meta name="viewport" content="width=640, height=480"/></head><body/></html>'
    expect(viewportFromDocument(xml)).toEqual({ width: 640, height: 480 })
  })

  it('falls back to an SVG viewBox for image-only pages', () => {
    const xml = '<html><body><svg viewBox="0 0 1024 768"><image href="p.jpg"/></svg></body></html>'
    expect(viewportFromDocument(xml)).toEqual({ width: 1024, height: 768 })
  })

  it('finds the primary image of a page', () => {
    expect(primaryImageHref('<html><body><img src="images/p12.jpg"/></body></html>')).toBe('images/p12.jpg')
    expect(primaryImageHref('<html><body><svg><image href="a.png"/></svg></body></html>')).toBe('a.png')
  })
})

describe('imageSize', () => {
  it('reads PNG dimensions from the IHDR chunk', () => {
    const png = new Uint8Array(32)
    new DataView(png.buffer).setUint32(0, 0x89504e47, false)
    new DataView(png.buffer).setUint32(16, 300, false)
    new DataView(png.buffer).setUint32(20, 200, false)
    expect(imageSize(png)).toEqual({ width: 300, height: 200 })
  })

  it('reads GIF dimensions', () => {
    const gif = new Uint8Array(16)
    const view = new DataView(gif.buffer)
    view.setUint32(0, 0x47494638, false)
    view.setUint16(6, 120, true)
    view.setUint16(8, 90, true)
    expect(imageSize(gif)).toEqual({ width: 120, height: 90 })
  })

  it('returns undefined for data that is not a known image', () => {
    expect(imageSize(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBeUndefined()
  })
})

describe('modalViewport', () => {
  it('picks the most common viewport', () => {
    expect(modalViewport([
      { width: 800, height: 1200 }, { width: 1600, height: 1200 }, { width: 800, height: 1200 },
    ])).toEqual({ width: 800, height: 1200 })
  })
  it('returns undefined for an empty list', () => {
    expect(modalViewport([])).toBeUndefined()
  })
})

const REFERENCE_BOOK = 'corpus/local/amelia-bedelia-birds.epub'
describe.skipIf(!existsSync(REFERENCE_BOOK))('imageSize against real JPEGs', () => {
  it('sniffs the reference book page images without decoding them', async () => {
    const archive = await ZipArchive.open(bufferSource(readFileSync(REFERENCE_BOOK)))
    expect(imageSize(await archive.read('OEBPS/images/page012.jpg'))).toEqual({ width: 800, height: 1199 })
    expect(imageSize(await archive.read('OEBPS/images/cover.jpg'))).toEqual({ width: 800, height: 1200 })
  })
})
