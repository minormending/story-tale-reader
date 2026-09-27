import { primaryImageHref } from '../engine/layout/viewport'
import { dirname, mimeTypeFor, resolvePath } from '../engine/path'
import type { BookPage } from '../engine/types'
import type { ZipArchive } from '../engine/zip/reader'

/** Wide enough to recognise a page by, small enough that a cache of them costs nothing. */
const THUMBNAIL_WIDTH = 240

export interface PageThumbnails {
  /** A small picture of the page, as an object URL, or undefined when it has none. */
  get(page: BookPage): Promise<string | undefined>
  /** Let go of every URL handed out. */
  dispose(): void
}

/**
 * Small pictures of a fixed-layout book's pages, for the page scrubber.
 *
 * A picture-book page is, almost always, one large illustration with a few words
 * laid over it, so the illustration is a recognisable picture of the page — and it
 * can be had from the archive without laying the page out, which rendering the
 * page itself in a frame for every step of a scrub would need. Each is shrunk once
 * and kept, so dragging back and forth decodes nothing twice.
 */
export function createPageThumbnails(archive: ZipArchive): PageThumbnails {
  const made = new Map<string, Promise<string | undefined>>()
  const urls: string[] = []

  const make = async (page: BookPage): Promise<string | undefined> => {
    try {
      const href = primaryImageHref(await archive.readText(page.path))
      if (!href) return undefined
      const path = resolvePath(dirname(page.path), href)
      if (!archive.has(path)) return undefined
      const bytes = await archive.read(path)
      const original = new Blob([bytes.slice().buffer as ArrayBuffer], { type: mimeTypeFor(path) })
      const url = URL.createObjectURL((await shrink(original)) ?? original)
      urls.push(url)
      return url
    } catch {
      return undefined
    }
  }

  return {
    get(page) {
      let pending = made.get(page.path)
      if (!pending) {
        pending = make(page)
        made.set(page.path, pending)
      }
      return pending
    },
    dispose() {
      for (const url of urls) URL.revokeObjectURL(url)
      urls.length = 0
      made.clear()
    },
  }
}

async function shrink(blob: Blob): Promise<Blob | undefined> {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') return undefined
  try {
    const bitmap = await createImageBitmap(blob, { resizeWidth: THUMBNAIL_WIDTH, resizeQuality: 'medium' })
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
    bitmap.close()
    return await canvas.convertToBlob({ type: 'image/webp', quality: 0.8 })
  } catch {
    return undefined
  }
}
