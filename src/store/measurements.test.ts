import { describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { loadEpub, MEASUREMENT_VERSION, type LayoutMeasurement } from '../engine/epub/load'
import { bufferSource } from '../engine/zip/reader'
import { recallMeasurement, rememberMeasurement } from './measurements'

/**
 * The cache as the shelf uses it: kept by one open, handed to the next.
 *
 * The fixture tests pass a measurement straight to loadEpub, which says nothing
 * about whether one survives a round trip through storage. It did not: from 0.15.1
 * the recalled row lost its version, loadEpub refused it, and every open measured
 * every page again.
 */

// IndexedDB, as far as this cache can tell: rows keyed by id, cloned on the way in
// and out.
const rows = vi.hoisted(() => new Map<string, unknown>())
vi.mock('./idb', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./idb')>()),
  put: async (_store: string, value: { id: string }) => void rows.set(value.id, structuredClone(value)),
  get: async (_store: string, key: string) => structuredClone(rows.get(key)),
}))

const fixture = 'corpus/fixtures/fxl-explicit-spreads.epub'
const open = (options = {}) => loadEpub(bufferSource(readFileSync(fixture)), {}, undefined, options)

describe('the layout cache', () => {
  it('gives back everything it kept', async () => {
    const kept: LayoutMeasurement = {
      version: MEASUREMENT_VERSION,
      pageCount: 2,
      viewportCoverage: 1,
      viewports: [{ width: 600, height: 800 }, undefined],
    }
    await rememberMeasurement('kept', kept)
    expect(await recallMeasurement('kept')).toEqual(kept)
  })

  it('recalls nothing for a book it has not seen', async () => {
    expect(await recallMeasurement('never-opened')).toBeUndefined()
  })

  it.skipIf(!existsSync(fixture))('saves the next open from measuring', async () => {
    const { measurement } = await open()

    // A size the book does not contain. If it comes back out, the pages were not
    // read this time — which is the whole point of the cache.
    const invented = { width: 111, height: 222 }
    await rememberMeasurement('fxl', { ...measurement, viewports: measurement.viewports.map(() => invented) })

    const { book } = await open({ cached: await recallMeasurement('fxl') })
    expect(book.pages.map((page) => page.viewport)).toEqual(book.pages.map(() => invented))
  })
})
