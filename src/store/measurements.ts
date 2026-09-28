/** The per-book layout cache: what a book's pages measured to, so reopening need not measure again. */

import type { LayoutMeasurement } from '../engine/epub/load'
import { STORE_LAYOUT, get, put } from './idb'

/**
 * Keep what a book measured, so the next open does not measure it again.
 *
 * Best effort in both directions: a shelf that cannot write its cache is slower, not
 * broken, and a cache that fails to read is simply a measurement that happens again.
 */
export async function rememberMeasurement(id: string, measurement?: LayoutMeasurement): Promise<void> {
  // A partial measurement means an override stood in for the real page sizes, and
  // caching that would answer a question nobody asked.
  if (!measurement || measurement.viewports.length !== measurement.pageCount) return
  try {
    await put(STORE_LAYOUT, { id, ...measurement })
  } catch {
    // Storage full or refused; the book still opened.
  }
}

export async function recallMeasurement(id: string): Promise<LayoutMeasurement | undefined> {
  try {
    const row = await get<LayoutMeasurement & { id: string }>(STORE_LAYOUT, id)
    if (!row) return undefined
    // Everything but the key, so whatever was kept comes back. Naming the fields
    // one by one dropped `version` when it was added, and loadEpub refuses a
    // measurement without one: from 0.15.1 every open measured again.
    const { id: _id, ...measurement } = row
    return measurement
  } catch {
    return undefined
  }
}
