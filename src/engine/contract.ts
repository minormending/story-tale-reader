/**
 * The engine's contract: what it makes of a book, as plain JSON.
 *
 * The Android app has its own engine, written in Kotlin rather than sharing this
 * code. The two are kept in step by comparing their output, book by book, against
 * files this module produces (corpus/expected/). A difference is either a bug in
 * the port or a change here that the port has not caught up with yet — and the
 * contract files say which, because they only change when this engine's output does.
 *
 * Everything is described in terms a port can reproduce: page indices rather than
 * object identity, and no field that depends on this runtime (no archive handles,
 * no progress callbacks). Absent optional fields are left out; the port treats a
 * missing key and a null as the same thing.
 */

import { loadEpub } from './epub/load'
import { DrmError } from './epub/ocf'
import { loadMobi } from './mobi/load'
import { MobiError } from './mobi/palmdb'
import { detectFormat } from './format'
import { buildSpreads } from './layout/spread'
import { parseSmil } from './overlays/smil'
import { bufferSource, ZipError, type ZipArchive } from './zip/reader'
import type { ParsedBook, Spread } from './types'

/** Bumped when the shape of a contract file changes, not when a book's output does. */
export const CONTRACT_VERSION = 1

export interface ContractSpread {
  left?: number
  right?: number
  center?: number
}

export interface Contract {
  contract: number
  file: string
  format: string
  /** Set instead of everything below when the engine refuses the book. */
  error?: { kind: 'drm' | 'mobi' | 'zip' | 'not-a-book' | 'other'; message: string }
  book?: ParsedBook
  /** Facing pages (landscape) and one page at a time (portrait). */
  spreads?: { paired: ContractSpread[]; single: ContractSpread[] }
  /** The same book opened with the reader's one-tap spread shift. */
  shifted?: { sides: string[]; paired: ContractSpread[] }
  /** Opened for the shelf without measuring (LoadOptions.measure = false). */
  deferred?: { sides: string[]; viewports: Array<{ width: number; height: number }> }
  /** What a later open would be handed back to skip measuring. */
  measurement?: { pageCount: number; viewportCoverage: number; viewports: Array<{ width: number; height: number } | null> }
  /** Every media overlay the pages reference, parsed into its timeline. */
  overlays?: Record<string, Array<{ textPath: string; fragment: string; audioPath: string; start: number; end: number }>>
}

export async function describeBook(bytes: Uint8Array, file: string): Promise<Contract> {
  const format = detectFormat(bytes.subarray(0, 128))
  const base = { contract: CONTRACT_VERSION, file, format }

  try {
    if (format === 'epub') return { ...base, ...(await describeEpub(bytes)) }
    if (format === 'mobi') return { ...base, ...(await describeMobi(bytes, file)) }
    return { ...base, error: { kind: 'not-a-book', message: `unsupported format: ${format}` } }
  } catch (error) {
    return { ...base, error: describeError(error) }
  }
}

async function describeEpub(bytes: Uint8Array): Promise<Partial<Contract>> {
  const opened = await loadEpub(bufferSource(bytes))
  const shifted = await loadEpub(bufferSource(bytes), { spreadShift: 1 })
  const deferred = await loadEpub(bufferSource(bytes), {}, undefined, { measure: false })

  return {
    ...summarise(opened.book),
    shifted: {
      sides: shifted.book.pages.map((page) => page.spreadSide),
      paired: spreads(buildSpreads(shifted.book.pages, shifted.book.direction, true)),
    },
    deferred: {
      sides: deferred.book.pages.map((page) => page.spreadSide),
      viewports: deferred.book.pages.map((page) => page.viewport),
    },
    measurement: {
      ...opened.measurement,
      viewports: opened.measurement.viewports.map((viewport) => viewport ?? null),
    },
    overlays: await overlays(opened.book, opened.archive),
  }
}

async function describeMobi(bytes: Uint8Array, file: string): Promise<Partial<Contract>> {
  const fallbackTitle = file.replace(/\.[^.]+$/, '')
  const opened = await loadMobi(bytes, fallbackTitle)
  const shifted = await loadMobi(bytes, fallbackTitle, { spreadShift: 1 })
  return {
    ...summarise(opened.book),
    shifted: {
      sides: shifted.book.pages.map((page) => page.spreadSide),
      paired: spreads(buildSpreads(shifted.book.pages, shifted.book.direction, true)),
    },
  }
}

function summarise(book: ParsedBook): Partial<Contract> {
  return {
    book,
    spreads: {
      paired: spreads(buildSpreads(book.pages, book.direction, true)),
      single: spreads(buildSpreads(book.pages, book.direction, false)),
    },
  }
}

function spreads(list: Spread[]): ContractSpread[] {
  return list.map((spread) => ({
    left: spread.left?.index,
    right: spread.right?.index,
    center: spread.center?.index,
  }))
}

async function overlays(book: ParsedBook, archive: ZipArchive): Promise<Contract['overlays']> {
  const out: NonNullable<Contract['overlays']> = {}
  for (const page of book.pages) {
    const path = page.overlayPath
    if (!path || path in out) continue
    let xml: string
    try {
      xml = await archive.readText(path)
    } catch {
      continue
    }
    out[path] = parseSmil(xml, path).map(({ textPath, fragment, audioPath, start, end }) => ({
      textPath, fragment, audioPath, start, end,
    }))
  }
  return out
}

function describeError(error: unknown): NonNullable<Contract['error']> {
  const message = error instanceof Error ? error.message : String(error)
  if (error instanceof DrmError) return { kind: 'drm', message }
  if (error instanceof MobiError) return { kind: 'mobi', message }
  if (error instanceof ZipError) return { kind: 'zip', message }
  if (/^Not an EPUB/.test(message)) return { kind: 'not-a-book', message }
  return { kind: 'other', message }
}

/**
 * Stable JSON: two-space indent, keys in insertion order, undefined dropped.
 *
 * Insertion order is the engine's own object construction order, which is stable
 * for a given version of the code — so a diff of a contract file is a diff of what
 * the engine decided, not noise from serialisation.
 */
export function contractJson(contract: Contract): string {
  return `${JSON.stringify(contract, null, 2)}\n`
}
