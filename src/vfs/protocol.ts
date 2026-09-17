/**
 * Protocol for the service-worker virtual filesystem (SPEC.md §4.3).
 *
 * EPUB pages reference their assets with relative URLs (`images/page012.jpg`,
 * `stylesheet.css`, `fonts/FuturaStd-Bold.woff`). Serving the book's ZIP entries
 * from a virtual path lets those URLs resolve natively, with no rewriting — and,
 * critically, keeps the page iframe same-origin so read-along can add the
 * highlight class to it. Blob URLs cannot do either.
 *
 * The service worker owns no ZIP code: it asks the window that opened the book for
 * bytes over a MessageChannel. One decompressor, one cache, one source of truth.
 */

export const VFS_SEGMENT = '__book__'

export interface BookFetchRequest {
  type: 'vfs:read'
  bookId: string
  path: string
}

export type BookFetchResponse =
  | { ok: true; bytes: ArrayBuffer; mimeType: string }
  | { ok: false; error: string; status: number }

/** Base path the app is served from; '/' in dev and in the Capacitor bundle. */
export function appBase(): string {
  const base = import.meta.env.BASE_URL || '/'
  return base.endsWith('/') ? base : `${base}/`
}

/** URL an iframe or <img> uses to reach a file inside an opened book. */
export function bookFileUrl(bookId: string, path: string): string {
  const encoded = path.split('/').map(encodeURIComponent).join('/')
  return `${appBase()}${VFS_SEGMENT}/${bookId}/${encoded}`
}

/** Inverse of bookFileUrl, for the service worker's fetch handler. */
export function parseBookFileUrl(pathname: string, base: string): { bookId: string; path: string } | undefined {
  const prefix = `${base}${VFS_SEGMENT}/`
  if (!pathname.startsWith(prefix)) return undefined
  const rest = pathname.slice(prefix.length)
  const slash = rest.indexOf('/')
  if (slash <= 0) return undefined
  return {
    bookId: rest.slice(0, slash),
    path: rest
      .slice(slash + 1)
      .split('/')
      .map((segment) => {
        try { return decodeURIComponent(segment) } catch { return segment }
      })
      .join('/'),
  }
}
