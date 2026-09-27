/**
 * Service-worker side of the virtual filesystem: asking a window for a book file.
 *
 * Kept out of src/sw.ts, which can only be loaded inside a service worker, so the
 * choice of window can be tested.
 */

import type { BookFetchResponse } from './protocol'

/** How long one window gets to answer before the next is asked. */
export const REQUEST_TIMEOUT_MS = 15_000

/** The part of a service worker's Client used here. */
export interface WindowClient {
  readonly frameType: FrameType
  postMessage(message: unknown, transfer: Transferable[]): void
}

/**
 * The windows that could be holding a book: the top-level ones.
 *
 * Each page of an open book is a window client too — a page frame is a same-origin
 * document — but pages run no scripts (see PageFrame's sandbox), so a page can never
 * answer, and asking one costs the whole timeout. Chromium lists the most recently
 * focused client first, and tapping a page focuses its frame. A page turned with a
 * tap was asked for its own stylesheets, then for its pictures, and sat blank for
 * fifteen seconds each time before the app was asked — with taps doing nothing,
 * because gestures attach to a page once it has loaded.
 *
 * Only if there is no top-level window — the app itself inside another site's
 * frame — is every window asked.
 */
export function bookHolders<T extends WindowClient>(clients: readonly T[]): T[] {
  const topLevel = clients.filter((client) => client.frameType === 'top-level')
  return topLevel.length > 0 ? topLevel : [...clients]
}

/** Ask each window that could hold the book, in turn, for one of its files. */
export async function askForBookFile(
  clients: readonly WindowClient[],
  bookId: string,
  path: string,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<BookFetchResponse> {
  const holders = bookHolders(clients)
  if (holders.length === 0) throw new Error('no window client is holding this book')

  // Try each: the one that opened the book may not be the first listed.
  let lastError = 'no client could serve the file'
  for (const client of holders) {
    try {
      return await requestFrom(client, bookId, path, timeoutMs)
    } catch (error) {
      lastError = String(error)
    }
  }
  throw new Error(lastError)
}

function requestFrom(client: WindowClient, bookId: string, path: string, timeoutMs: number): Promise<BookFetchResponse> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel()
    const timer = setTimeout(() => {
      channel.port1.close()
      reject(new Error('timed out'))
    }, timeoutMs)

    channel.port1.onmessage = (event: MessageEvent<BookFetchResponse>) => {
      clearTimeout(timer)
      channel.port1.close()
      resolve(event.data)
    }
    client.postMessage({ type: 'vfs:read', bookId, path }, [channel.port2])
  })
}
