/**
 * Book file storage.
 *
 * Books are kept verbatim — never re-encoded — so the user's file is never damaged
 * and can be exported again unchanged. OPFS is preferred because it supports real
 * random access, which is what lets the ZIP reader inflate one page at a time; old
 * WebViews without it fall back to IndexedDB blobs (SPEC.md §9.1).
 */

import { STORE_BLOBS, get, put, remove } from './idb'

function opfsAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'storage' in navigator && 'getDirectory' in navigator.storage
}

async function booksDirectory(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle('books', { create: true })
}

export async function saveBookFile(id: string, blob: Blob): Promise<void> {
  if (opfsAvailable()) {
    try {
      const dir = await booksDirectory()
      const handle = await dir.getFileHandle(id, { create: true })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return
    } catch {
      // Fall through to IndexedDB.
    }
  }
  await put(STORE_BLOBS, { id, blob })
}

export async function loadBookFile(id: string): Promise<Blob | undefined> {
  if (opfsAvailable()) {
    try {
      const dir = await booksDirectory()
      const handle = await dir.getFileHandle(id)
      return await handle.getFile()
    } catch {
      // Not in OPFS — it may predate the fallback, or have been written there.
    }
  }
  const record = await get<{ id: string; blob: Blob }>(STORE_BLOBS, id)
  return record?.blob
}

export async function deleteBookFile(id: string): Promise<void> {
  if (opfsAvailable()) {
    try {
      const dir = await booksDirectory()
      await dir.removeEntry(id)
    } catch {
      // Not there; the IndexedDB delete below still runs.
    }
  }
  await remove(STORE_BLOBS, id)
}

/** Ask the browser not to evict the library under storage pressure. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist()
  } catch {
    /* ignore */
  }
  return false
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | undefined> {
  try {
    const estimate = await navigator.storage?.estimate?.()
    if (estimate) return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 }
  } catch {
    /* ignore */
  }
  return undefined
}
