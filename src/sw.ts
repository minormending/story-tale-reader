/// <reference lib="webworker" />
/**
 * Service worker: app-shell precache plus the book virtual filesystem.
 *
 * Book requests are answered by asking a window client for the bytes rather than
 * duplicating the ZIP reader here — see src/vfs/protocol.ts for why.
 */
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching'
import { VFS_SEGMENT, type BookFetchResponse } from './vfs/protocol'

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>
}

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

self.addEventListener('install', () => {
  void self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

const BASE = new URL(self.registration.scope).pathname
const PREFIX = `${BASE}${VFS_SEGMENT}/`
const REQUEST_TIMEOUT_MS = 15_000

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin || !url.pathname.startsWith(PREFIX)) return
  event.respondWith(serveBookFile(url.pathname, event.request))
})

async function serveBookFile(pathname: string, request: Request): Promise<Response> {
  const rest = pathname.slice(PREFIX.length)
  const slash = rest.indexOf('/')
  if (slash <= 0) return new Response('Bad book path', { status: 400 })

  const bookId = rest.slice(0, slash)
  const path = rest
    .slice(slash + 1)
    .split('/')
    .map((segment) => {
      try { return decodeURIComponent(segment) } catch { return segment }
    })
    .join('/')

  let reply: BookFetchResponse
  try {
    reply = await askClient(bookId, path)
  } catch (error) {
    return new Response(`Book file unavailable: ${String(error)}`, { status: 504 })
  }
  if (!reply.ok) return new Response(reply.error, { status: reply.status })

  const headers = new Headers({
    'Content-Type': reply.mimeType,
    'Cache-Control': 'no-store',
    'Accept-Ranges': 'bytes',
  })

  // Media elements issue range requests; without this, seeking narration breaks.
  const range = request.headers.get('Range')
  const total = reply.bytes.byteLength
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range)
    if (match) {
      const start = match[1] ? Number.parseInt(match[1], 10) : 0
      const end = match[2] ? Math.min(Number.parseInt(match[2], 10), total - 1) : total - 1
      if (start <= end && start < total) {
        headers.set('Content-Range', `bytes ${start}-${end}/${total}`)
        headers.set('Content-Length', String(end - start + 1))
        return new Response(reply.bytes.slice(start, end + 1), { status: 206, headers })
      }
    }
  }

  headers.set('Content-Length', String(total))
  return new Response(reply.bytes, { status: 200, headers })
}

async function askClient(bookId: string, path: string): Promise<BookFetchResponse> {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  if (clients.length === 0) throw new Error('no window client is holding this book')

  // Try each client: the one that opened the book may not be the first listed.
  let lastError = 'no client could serve the file'
  for (const client of clients) {
    try {
      return await requestFrom(client, bookId, path)
    } catch (error) {
      lastError = String(error)
    }
  }
  throw new Error(lastError)
}

function requestFrom(client: Client, bookId: string, path: string): Promise<BookFetchResponse> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel()
    const timer = setTimeout(() => {
      channel.port1.close()
      reject(new Error('timed out'))
    }, REQUEST_TIMEOUT_MS)

    channel.port1.onmessage = (event: MessageEvent<BookFetchResponse>) => {
      clearTimeout(timer)
      channel.port1.close()
      resolve(event.data)
    }
    client.postMessage({ type: 'vfs:read', bookId, path }, [channel.port2])
  })
}
