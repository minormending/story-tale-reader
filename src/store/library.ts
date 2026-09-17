/** The library: persisted book records, covers, reading position and overrides. */

import { loadEpub } from '../engine/epub/load'
import { ZipArchive, blobSource } from '../engine/zip/reader'
import { dirname, resolvePath, mimeTypeFor } from '../engine/path'
import { primaryImageHref } from '../engine/layout/viewport'
import type { BookFormat, LayoutMode, LayoutOverrides, ParsedBook } from '../engine/types'
import { STORE_BOOKS, STORE_OVERRIDES, STORE_PROGRESS, get, getAll, put, remove } from './idb'
import { deleteBookFile, loadBookFile, requestPersistence, saveBookFile } from './files'

export interface LibraryEntry {
  id: string
  title: string
  creator?: string
  format: BookFormat
  fileName: string
  size: number
  addedAt: number
  lastOpenedAt: number
  pageCount: number
  layout: LayoutMode
  hasMediaOverlays: boolean
  cover?: Blob
}

export interface Progress {
  id: string
  pageIndex: number
  /** Screen within a reflowable section; unused for fixed-layout books. */
  screen?: number
  updatedAt: number
}

export interface OpenedBook {
  entry: LibraryEntry
  book: ParsedBook
  archive: ZipArchive
}

const THUMBNAIL_WIDTH = 480

/** Stable identity from the file's head and size, so re-importing replaces rather than duplicates. */
export async function fingerprint(file: Blob): Promise<string> {
  const head = await file.slice(0, 1024 * 1024).arrayBuffer()
  const salted = new Uint8Array(head.byteLength + 8)
  salted.set(new Uint8Array(head), 0)
  new DataView(salted.buffer).setFloat64(head.byteLength, file.size, true)
  const digest = await crypto.subtle.digest('SHA-256', salted)
  return [...new Uint8Array(digest).slice(0, 12)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export async function listLibrary(): Promise<LibraryEntry[]> {
  const entries = await getAll<LibraryEntry>(STORE_BOOKS)
  return entries.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
}

export async function importBook(file: File): Promise<OpenedBook> {
  const id = await fingerprint(file)
  const existing = await get<LibraryEntry>(STORE_BOOKS, id)

  // Parse before storing: a book we cannot open should not enter the library.
  const { book, archive } = await loadEpub(blobSource(file))

  await saveBookFile(id, file)
  void requestPersistence()

  const entry: LibraryEntry = {
    id,
    title: book.metadata.title,
    creator: book.metadata.creator,
    format: book.format,
    fileName: file.name,
    size: file.size,
    addedAt: existing?.addedAt ?? Date.now(),
    lastOpenedAt: Date.now(),
    pageCount: book.pages.length,
    layout: book.layout,
    hasMediaOverlays: book.hasMediaOverlays,
    cover: existing?.cover ?? (await extractCover(archive, book)),
  }
  await put(STORE_BOOKS, entry)
  return { entry, book, archive }
}

export async function openStoredBook(id: string): Promise<OpenedBook> {
  const entry = await get<LibraryEntry>(STORE_BOOKS, id)
  if (!entry) throw new Error('That book is no longer in the library')

  const blob = await loadBookFile(id)
  if (!blob) throw new Error('The book file is missing from storage. Import it again.')

  const { book, archive } = await loadEpub(blobSource(blob))
  const touched: LibraryEntry = { ...entry, lastOpenedAt: Date.now() }
  await put(STORE_BOOKS, touched)
  return { entry: touched, book, archive }
}

export async function deleteBook(id: string): Promise<void> {
  await Promise.all([
    remove(STORE_BOOKS, id),
    remove(STORE_PROGRESS, id),
    remove(STORE_OVERRIDES, id),
    deleteBookFile(id),
  ])
}

/* ----------------------------- reading position ----------------------------- */

export async function getProgress(id: string): Promise<{ pageIndex: number; screen: number }> {
  const stored = await get<Progress>(STORE_PROGRESS, id)
  return { pageIndex: stored?.pageIndex ?? 0, screen: stored?.screen ?? 0 }
}

export async function saveProgress(id: string, pageIndex: number, screen = 0): Promise<void> {
  await put(STORE_PROGRESS, { id, pageIndex, screen, updatedAt: Date.now() } satisfies Progress)
}

/* -------------------------------- overrides -------------------------------- */

export async function getOverrides(id: string): Promise<LayoutOverrides> {
  const stored = await get<LayoutOverrides & { id: string }>(STORE_OVERRIDES, id)
  if (!stored) return {}
  const { id: _ignored, ...overrides } = stored
  return overrides
}

export async function saveOverrides(id: string, overrides: LayoutOverrides): Promise<void> {
  await put(STORE_OVERRIDES, { id, ...overrides })
}

/* ---------------------------------- covers ---------------------------------- */

/**
 * A downscaled cover for the shelf. Stored as a thumbnail rather than the book's
 * full-size image so the library stays fast and small on a tablet.
 */
async function extractCover(archive: ZipArchive, book: ParsedBook): Promise<Blob | undefined> {
  const path = book.coverPath ?? (await firstPageImage(archive, book))
  if (!path || !archive.has(path)) return undefined

  try {
    const bytes = await archive.read(path)
    const original = new Blob([bytes.slice().buffer as ArrayBuffer], { type: mimeTypeFor(path) })
    return (await downscale(original)) ?? original
  } catch {
    return undefined
  }
}

async function firstPageImage(archive: ZipArchive, book: ParsedBook): Promise<string | undefined> {
  const first = book.pages[0]
  if (!first || !archive.has(first.path)) return undefined
  try {
    const href = primaryImageHref(await archive.readText(first.path))
    return href ? resolvePath(dirname(first.path), href) : undefined
  } catch {
    return undefined
  }
}

async function downscale(blob: Blob): Promise<Blob | undefined> {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') return undefined
  try {
    const bitmap = await createImageBitmap(blob)
    if (bitmap.width <= THUMBNAIL_WIDTH) {
      bitmap.close()
      return undefined
    }
    const scale = THUMBNAIL_WIDTH / bitmap.width
    const canvas = new OffscreenCanvas(THUMBNAIL_WIDTH, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) {
      bitmap.close()
      return undefined
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    return await canvas.convertToBlob({ type: 'image/webp', quality: 0.82 })
  } catch {
    return undefined
  }
}
