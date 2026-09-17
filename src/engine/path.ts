/** Path helpers for container-relative hrefs (which are URLs, not filesystem paths). */

export function dirname(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? '' : path.slice(0, slash)
}

export function splitFragment(href: string): [path: string, fragment: string] {
  const hash = href.indexOf('#')
  return hash === -1 ? [href, ''] : [href.slice(0, hash), href.slice(hash + 1)]
}

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

/**
 * Resolve an href against a base directory, the way a browser would.
 * Hrefs inside EPUB documents are percent-encoded URLs; ZIP entry names are not.
 */
export function resolvePath(baseDir: string, href: string): string {
  const [raw] = splitFragment(href)
  const path = decode(raw)
  const segments = path.startsWith('/')
    ? path.slice(1).split('/')
    : [...(baseDir ? baseDir.split('/') : []), ...path.split('/')]

  const out: string[] = []
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') out.pop()
    else out.push(segment)
  }
  return out.join('/')
}

export function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot === -1 ? '' : base.slice(dot + 1).toLowerCase()
}

const MIME_BY_EXTENSION: Record<string, string> = {
  xhtml: 'application/xhtml+xml', html: 'text/html', htm: 'text/html',
  css: 'text/css', js: 'text/javascript', mjs: 'text/javascript',
  xml: 'application/xml', ncx: 'application/x-dtbncx+xml', smil: 'application/smil+xml',
  opf: 'application/oebps-package+xml', json: 'application/json',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  svg: 'image/svg+xml', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'video/mp4', aac: 'audio/aac',
  ogg: 'audio/ogg', opus: 'audio/ogg', wav: 'audio/wav', webm: 'video/webm',
  pdf: 'application/pdf', txt: 'text/plain',
}

export function mimeTypeFor(path: string): string {
  return MIME_BY_EXTENSION[extensionOf(path)] ?? 'application/octet-stream'
}
