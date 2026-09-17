/**
 * Window side of the virtual filesystem: registers the service worker and answers
 * its requests for book files out of the opened archive.
 */

import { ZipArchive } from '../engine/zip/reader'
import { mimeTypeFor } from '../engine/path'
import type { BookFetchRequest, BookFetchResponse } from './protocol'

const archives = new Map<string, ZipArchive>()
let listening = false

export function mountBook(bookId: string, archive: ZipArchive): void {
  archives.set(bookId, archive)
}

export function unmountBook(bookId: string): void {
  archives.delete(bookId)
}

export type VfsStatus = 'ready' | 'unsupported' | 'failed'

/**
 * Registering is best-effort: without a service worker the app still runs, but
 * fixed-layout rendering and read-along are unavailable (SPEC.md §9.3).
 */
export async function startVfs(): Promise<VfsStatus> {
  listen()
  if (!('serviceWorker' in navigator)) return 'unsupported'

  try {
    const base = import.meta.env.BASE_URL || '/'
    const swUrl = import.meta.env.DEV ? `${base}dev-sw.js?dev-sw` : `${base}sw.js`
    await navigator.serviceWorker.register(swUrl, {
      type: import.meta.env.DEV ? 'module' : 'classic',
      scope: base,
    })
    await navigator.serviceWorker.ready
    // A freshly-registered worker does not control this page until it claims it.
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => {
        const done = (): void => {
          navigator.serviceWorker.removeEventListener('controllerchange', done)
          resolve()
        }
        navigator.serviceWorker.addEventListener('controllerchange', done)
        setTimeout(done, 3000)
      })
    }
    return navigator.serviceWorker.controller ? 'ready' : 'failed'
  } catch {
    return 'failed'
  }
}

function listen(): void {
  if (listening || !('serviceWorker' in navigator)) return
  listening = true

  navigator.serviceWorker.addEventListener('message', (event: MessageEvent<BookFetchRequest>) => {
    const request = event.data
    const port = event.ports[0]
    if (!port || request?.type !== 'vfs:read') return
    void respond(request, port)
  })
}

async function respond(request: BookFetchRequest, port: MessagePort): Promise<void> {
  const archive = archives.get(request.bookId)
  if (!archive) {
    port.postMessage({ ok: false, error: 'Book is not open', status: 404 } satisfies BookFetchResponse)
    return
  }
  try {
    const bytes = await archive.read(request.path)
    // Copy into a fresh buffer: the cached entry is a view into the archive and
    // must not be detached by the transfer.
    const copy = bytes.slice().buffer
    port.postMessage(
      { ok: true, bytes: copy, mimeType: mimeTypeFor(request.path) } satisfies BookFetchResponse,
      [copy],
    )
  } catch (error) {
    port.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : 'Read failed',
      status: 404,
    } satisfies BookFetchResponse)
  }
}
