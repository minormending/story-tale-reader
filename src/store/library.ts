/** The library: persisted book records, covers, reading position and overrides. */

import { loadEpub } from '../engine/epub/load'
import { loadPdf, renderPdfPage } from '../engine/pdf/load'
import { detectBlobFormat } from '../engine/format'
import { ZipArchive, blobSource } from '../engine/zip/reader'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { dirname, resolvePath, mimeTypeFor } from '../engine/path'
import { primaryImageHref } from '../engine/layout/viewport'
import type { LayoutMeasurement } from '../engine/epub/load'
import type {
  BookFormat,
  LayoutMode,
  LayoutOverrides,
  ParsedBook,
  ProgressReporter,
} from '../engine/types'
import {
  STORE_BOOKS,
  STORE_LAYOUT,
  STORE_OVERRIDES,
  STORE_PROGRESS,
  get,
  getAll,
  put,
  remove,
} from './idb'
import { latestOnly } from './latest'
import { deleteBookFile, loadBookFile, requestPersistence, saveBookFile } from './files'
import { removeBookmarksFor } from './bookmarks'
import { recallMeasurement, rememberMeasurement } from './measurements'
import { sameGroupName, tidyGroupName } from './groupNames'

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
  /** From the book's own metadata, when it declares a series. */
  series?: string
  seriesIndex?: number
  hasMediaOverlays: boolean
  cover?: Blob
  /**
   * Which version of the cover maker last tried, when it produced nothing.
   *
   * A missing cover is retried (repairCovers) while this is older than
   * COVER_VERSION, so a fix to the cover maker reaches books already on the shelf,
   * and a book that simply has no picture is not re-read on every launch.
   */
  coverVersion?: number
  /**
   * Where the reader has put this book on the shelf, overriding the automatic
   * series grouping: a group's name, or `null` for "in no group, whatever the shelf
   * would guess". Absent means the shelf decides. A group exists only as long as
   * some book names it, so there is nothing else to store or clean up.
   */
  shelfGroup?: string | null
}

export interface Progress {
  id: string
  pageIndex: number
  /** Screen within a reflowable section; unused for fixed-layout books. */
  screen?: number
  /**
   * Reflowable only: the element at the top of the screen, by its index among the
   * body's children. Preferred over `screen` on the way back, because a screen
   * number is a function of the current type size and drifts the moment it changes.
   * `screen` is kept as the fallback for positions saved before this existed.
   */
  anchor?: number
  updatedAt: number
}

export interface OpenedBook {
  /** False when the book opened but could not be kept on the shelf. */
  persisted?: boolean
  entry: LibraryEntry
  book: ParsedBook
  /** Present for EPUBs — the source for the virtual filesystem and read-along. */
  archive?: ZipArchive
  /** Present for PDFs. */
  pdf?: PDFDocumentProxy
}

const THUMBNAIL_WIDTH = 480

/**
 * Bumped when the cover maker changes in a way that could now succeed where it
 * failed before. 3: PDF covers, which until 0.13.1 always failed (see
 * renderPdfPage), and which drew scanned pages blank until pdf.js was given its
 * JPEG 2000 and JBIG2 decoders.
 */
const COVER_VERSION = 3

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

/** Open a blob as whatever it actually is, rather than trusting its extension. */
async function parse(
  blob: Blob,
  fileName: string,
  onProgress?: ProgressReporter,
  options: { cached?: LayoutMeasurement; measure?: boolean } = {},
): Promise<Omit<OpenedBook, 'entry'> & { measurement?: LayoutMeasurement }> {
  const format = await detectBlobFormat(blob)

  if (format === 'pdf') {
    onProgress?.({ stage: 'unpacking' })
    const { book, document } = await loadPdf(await blob.arrayBuffer(), stripExtension(fileName))
    return { book, pdf: document }
  }

  if (format === 'mobi') {
    onProgress?.({ stage: 'unpacking' })
    const { loadMobi } = await import('../engine/mobi/load')
    const { book, archive } = await loadMobi(new Uint8Array(await blob.arrayBuffer()), stripExtension(fileName))
    return { book, archive }
  }

  if (format === 'unknown') {
    throw new Error('This file is not an EPUB, PDF or MOBI book.')
  }

  const { book, archive, measurement } = await loadEpub(blobSource(blob), {}, onProgress, options)
  return { book, archive, measurement }
}

function stripExtension(name: string): string {
  return name.replace(/\.[^.]+$/, '') || 'Untitled'
}

export async function importBook(
  file: File,
  onProgress?: ProgressReporter,
  /**
   * Adding to the shelf without opening. Skips measuring the pages, which the entry
   * does not need and which the first open will do anyway.
   */
  options: { measure?: boolean } = {},
): Promise<OpenedBook> {
  onProgress?.({ stage: 'reading' })
  const id = await fingerprint(file)
  const existing = await get<LibraryEntry>(STORE_BOOKS, id)

  // Parse before storing: a book we cannot open should not enter the library.
  const opened = await parse(file, file.name, onProgress, {
    cached: await recallMeasurement(id),
    measure: options.measure,
  })

  // Storing is best effort from here on. The book is parsed and in memory, so a
  // full or restricted quota should cost the reader their shelf entry, not their
  // ability to read the book they just opened.
  onProgress?.({ stage: 'saving' })
  const stored = await saveBookFile(id, file)
  void requestPersistence()

  const entry: LibraryEntry = {
    id,
    title: opened.book.metadata.title,
    creator: opened.book.metadata.creator,
    format: opened.book.format,
    fileName: file.name,
    size: file.size,
    addedAt: existing?.addedAt ?? Date.now(),
    lastOpenedAt: Date.now(),
    pageCount: opened.book.pages.length,
    layout: opened.book.layout,
    series: opened.book.metadata.series,
    seriesIndex: opened.book.metadata.seriesIndex,
    hasMediaOverlays: opened.book.hasMediaOverlays,
    cover: existing?.cover ?? (await makeCover(opened)),
    coverVersion: existing?.cover ? existing.coverVersion : COVER_VERSION,
    // Re-adding a book keeps it where the reader put it.
    ...(existing?.shelfGroup !== undefined ? { shelfGroup: existing.shelfGroup } : {}),
  }
  const listed = await saveEntry(entry)
  await rememberMeasurement(id, opened.measurement)
  return { entry, ...opened, persisted: stored && listed }
}

/**
 * Put books in a group of the reader's own (a name), in no group at all (`null`),
 * or back under the shelf's automatic grouping (`undefined`).
 */
export async function setShelfGroup(ids: string[], group: string | null | undefined): Promise<void> {
  const name = typeof group === 'string' ? tidyGroupName(group) : group
  if (name === '') return
  for (const id of ids) {
    const entry = await get<LibraryEntry>(STORE_BOOKS, id)
    if (!entry) continue
    const next: LibraryEntry = { ...entry }
    if (name === undefined) delete next.shelfGroup
    else next.shelfGroup = name
    await saveEntry(next)
  }
}

/** Rename one of the reader's groups, on every book in it. */
export async function renameShelfGroup(from: string, to: string): Promise<void> {
  if (!tidyGroupName(to)) return
  const members = (await listLibrary()).filter(
    (entry) => typeof entry.shelfGroup === 'string' && sameGroupName(entry.shelfGroup, from),
  )
  await setShelfGroup(members.map((entry) => entry.id), to)
}

/**
 * Go back for covers an earlier version of the cover maker could not make.
 *
 * Every PDF added before 0.13.1 arrived without a cover, or with a blank one.
 * Nothing else would ever fix those entries — adding the file again would, but
 * adding a folder skips books already on the shelf — so each gets one more try from
 * its stored file, one book at a time, reported as it lands. `stop` is asked between books, so the work gives
 * way the moment somebody opens something to read.
 */
export async function repairCovers(
  onRepaired: (entry: LibraryEntry) => void,
  stop: () => boolean,
): Promise<void> {
  // Missing covers, and PDF covers from before the decoders, which may be blank.
  const due = (entry: LibraryEntry) =>
    (entry.coverVersion ?? 1) < COVER_VERSION && (!entry.cover || entry.format === 'pdf')
  for (const candidate of (await listLibrary()).filter(due)) {
    if (stop()) return
    let cover: Blob | undefined
    try {
      const blob = await loadBookFile(candidate.id)
      if (!blob) continue
      const opened = await parse(blob, candidate.fileName, undefined, { measure: false })
      try {
        cover = await makeCover(opened)
      } finally {
        await opened.pdf?.loadingTask.destroy()
      }
    } catch {
      // A book that no longer parses is left for opening it to explain.
    }
    // Read again before writing: the entry may have been opened, and so updated,
    // while its cover was being made.
    const current = await get<LibraryEntry>(STORE_BOOKS, candidate.id)
    if (!current || !due(current) || stop()) continue
    const repaired: LibraryEntry = { ...current, cover: cover ?? current.cover, coverVersion: COVER_VERSION }
    await saveEntry(repaired)
    if (cover) onRepaired(repaired)
  }
}

/**
 * Write the shelf record, dropping the cover if that is what the store refuses.
 * A cover is the largest thing in the record and the only optional one.
 */
async function saveEntry(entry: LibraryEntry): Promise<boolean> {
  try {
    await put(STORE_BOOKS, entry)
    return true
  } catch {
    try {
      await put(STORE_BOOKS, { ...entry, cover: undefined })
      return true
    } catch {
      return false
    }
  }
}

export async function openStoredBook(id: string, onProgress?: ProgressReporter): Promise<OpenedBook> {
  const entry = await get<LibraryEntry>(STORE_BOOKS, id)
  if (!entry) throw new Error('That book is no longer in the library')

  onProgress?.({ stage: 'reading' })
  const blob = await loadBookFile(id)
  if (!blob) {
    // The record outlived its file — the browser evicted it under storage
    // pressure, or it was cleared. Leaving the row on the shelf gives a book that
    // can never open, so take it off and say so.
    await deleteBook(id)
    throw new Error(
      `\u201c${entry.title}\u201d is no longer stored on this device, so it has been ` +
        'removed from your shelf. Add the file again to read it.',
    )
  }

  const opened = await parse(blob, entry.fileName, onProgress, { cached: await recallMeasurement(id) })
  // What the book turned out to be this time, which a better reading of it can change
  // (a Kindle conversion first filed as reflowable, say), so the shelf says so too.
  const touched: LibraryEntry = {
    ...entry,
    lastOpenedAt: Date.now(),
    layout: opened.book.layout,
    pageCount: opened.book.pages.length,
  }
  await saveEntry(touched)
  await rememberMeasurement(id, opened.measurement)
  return { entry: touched, ...opened, persisted: true }
}

export async function deleteBook(id: string): Promise<void> {
  await Promise.all([
    remove(STORE_BOOKS, id),
    remove(STORE_PROGRESS, id),
    remove(STORE_OVERRIDES, id),
    remove(STORE_LAYOUT, id),
    removeBookmarksFor(id),
    deleteBookFile(id),
  ])
}

/* ----------------------------- reading position ----------------------------- */

export async function getProgress(
  id: string,
): Promise<{ pageIndex: number; screen: number; anchor?: number }> {
  const stored = await get<Progress>(STORE_PROGRESS, id)
  return {
    pageIndex: stored?.pageIndex ?? 0,
    screen: stored?.screen ?? 0,
    anchor: stored?.anchor,
  }
}

/**
 * Coalesced: a position is saved when it changes, one write per book at a time,
 * keeping only the newest while one is in flight (see ./latest).
 */
const writeProgress = latestOnly<Progress>(
  (_id, progress) => put(STORE_PROGRESS, progress),
  (a, b) => a.pageIndex === b.pageIndex && a.screen === b.screen && a.anchor === b.anchor,
)

export async function saveProgress(
  id: string,
  pageIndex: number,
  screen = 0,
  anchor?: number,
): Promise<void> {
  await writeProgress(id, { id, pageIndex, screen, anchor, updatedAt: Date.now() } satisfies Progress)
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
async function makeCover(opened: Omit<OpenedBook, 'entry'>): Promise<Blob | undefined> {
  if (opened.pdf) return pdfCover(opened.pdf)
  if (opened.archive) return extractCover(opened.archive, opened.book)
  return undefined
}

/** First page of a PDF, rendered small. */
async function pdfCover(document: PDFDocumentProxy): Promise<Blob | undefined> {
  if (typeof OffscreenCanvas !== 'function') return undefined
  try {
    const page = await document.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const scale = THUMBNAIL_WIDTH / base.width
    const canvas = new OffscreenCanvas(1, 1)
    await renderPdfPage(document, 1, canvas, scale, 1)
    return await canvas.convertToBlob({
      type: 'image/webp',
      quality: 0.82,
    })
  } catch {
    return undefined
  }
}

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
