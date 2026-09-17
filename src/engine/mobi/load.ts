/**
 * MOBI / AZW3 support (SPEC.md §8.2).
 *
 * The book is unpacked into an in-memory EPUB and handed to the normal EPUB loader,
 * so MOBI inherits the whole reading pipeline — virtual filesystem, pagination,
 * typography, library — instead of growing a second one.
 *
 * Old MOBI is a genuinely unpleasant format and this is best-effort, as the spec
 * says. HUFF/CDIC-compressed books are detected and refused with a clear message
 * rather than rendered as rubbish.
 */

import { zipSync, strToU8 } from 'fflate'
import { loadEpub } from '../epub/load'
import { DrmError } from '../epub/ocf'
import { bufferSource, type ZipArchive } from '../zip/reader'
import { imageSize } from '../layout/viewport'
import { MobiError, parsePalmDatabase, recordBytes, type PalmDatabase } from './palmdb'
import { decompressPalmDoc } from './palmdoc'
import {
  EXTH_AUTHOR, EXTH_COVER_OFFSET, EXTH_KF8_BOUNDARY, EXTH_PUBLISHER,
  decodeText, exthNumber, exthString, parseMobiHeader, trailingByteCount, type MobiHeader,
} from './header'
import type { LayoutOverrides, ParsedBook } from '../types'

const COMPRESSION_NONE = 1
const COMPRESSION_PALMDOC = 2
const COMPRESSION_HUFF_CDIC = 17480

/** Merge tiny sections until each is at least this big, to keep paging responsive. */
const MIN_SECTION_BYTES = 8 * 1024
const MAX_SECTIONS = 300

export interface LoadedMobi {
  book: ParsedBook
  archive: ZipArchive
}

export async function loadMobi(
  bytes: Uint8Array,
  fallbackTitle: string,
  overrides: LayoutOverrides = {},
): Promise<LoadedMobi> {
  const db = parsePalmDatabase(bytes)
  const header = pickHeader(db)

  if (header.encryptionType !== 0) {
    throw new DrmError(
      'This Kindle book is encrypted (DRM). Story Tale Reader does not remove DRM — ' +
        'read it in the Kindle app, or use a DRM-free copy.',
    )
  }

  if (header.compression === COMPRESSION_HUFF_CDIC) {
    throw new MobiError(
      'This book uses HUFF/CDIC compression, which is not supported yet. ' +
        'Converting it to EPUB will work.',
    )
  }
  if (header.compression !== COMPRESSION_NONE && header.compression !== COMPRESSION_PALMDOC) {
    throw new MobiError(`Unsupported MOBI compression (${header.compression})`)
  }

  const markup = readText(db, header)
  const images = collectImages(db, header)
  const isKf8 = header.fileVersion >= 8 || header.mobiType === 8

  const sections = splitIntoSections(markup, isKf8).map((section) =>
    rewriteMarkup(section, images),
  )
  if (sections.length === 0) throw new MobiError('This book contains no readable text')

  const title = header.fullName?.trim() || db.name || fallbackTitle
  const zip = buildEpub({
    title,
    creator: exthString(header, EXTH_AUTHOR),
    publisher: exthString(header, EXTH_PUBLISHER),
    sections,
    images,
    coverName: coverImageName(header, images),
  })

  const { book, archive } = await loadEpub(bufferSource(zip), overrides)
  return { book: { ...book, format: 'mobi' }, archive }
}

/* ------------------------------ which header ------------------------------ */

/**
 * A .mobi bought from Amazon often contains both an old MOBI 6 book and a modern
 * KF8 one. EXTH 121 points at where the KF8 part starts; prefer it, because its
 * markup is real XHTML rather than HTML 3.2.
 */
function pickHeader(db: PalmDatabase): MobiHeader {
  const first = parseMobiHeader(db, 0)
  const boundary = exthNumber(first, EXTH_KF8_BOUNDARY)

  if (boundary !== undefined && boundary !== 0xffffffff && boundary > 0 && boundary < db.records.length) {
    try {
      const kf8 = parseMobiHeader(db, boundary)
      if (kf8.textRecordCount > 0) return kf8
    } catch {
      // Fall back to the MOBI 6 part.
    }
  }
  return first
}

/* --------------------------------- text --------------------------------- */

function readText(db: PalmDatabase, header: MobiHeader): string {
  const parts: Uint8Array[] = []
  let total = 0

  for (let i = 1; i <= header.textRecordCount; i++) {
    const index = header.baseRecord + i
    if (index >= db.records.length) break

    let record = recordBytes(db, index)
    const trailing = trailingByteCount(record, header.extraDataFlags)
    if (trailing > 0) record = record.subarray(0, record.byteLength - trailing)

    const chunk =
      header.compression === COMPRESSION_PALMDOC ? decompressPalmDoc(record) : record
    parts.push(chunk)
    total += chunk.byteLength
  }

  const joined = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    joined.set(part, offset)
    offset += part.byteLength
  }

  const limit = header.textLength > 0 ? Math.min(header.textLength, joined.byteLength) : joined.byteLength
  return decodeText(joined.subarray(0, limit), header.encoding)
}

/* -------------------------------- images -------------------------------- */

interface MobiImage {
  /** 1-based index as referenced by recindex / kindle:embed. */
  reference: number
  name: string
  bytes: Uint8Array
  mimeType: string
}

function collectImages(db: PalmDatabase, header: MobiHeader): MobiImage[] {
  const start = header.firstImageIndex
  if (!start || start >= db.records.length) return []

  const out: MobiImage[] = []
  for (let index = start; index < db.records.length; index++) {
    let record: Uint8Array
    try {
      record = recordBytes(db, index)
    } catch {
      break
    }
    const type = imageMimeType(record)
    if (!type) continue

    const reference = index - start + 1
    out.push({
      reference,
      name: `img${String(reference).padStart(5, '0')}.${type.extension}`,
      bytes: record,
      mimeType: type.mimeType,
    })
  }
  return out
}

function imageMimeType(bytes: Uint8Array): { mimeType: string; extension: string } | undefined {
  if (bytes.byteLength < 12) return undefined
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return { mimeType: 'image/jpeg', extension: 'jpg' }
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return { mimeType: 'image/png', extension: 'png' }
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return { mimeType: 'image/gif', extension: 'gif' }
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return { mimeType: 'image/bmp', extension: 'bmp' }
  // Not an image record (index data, FLIS/FCIS, the end-of-file marker...).
  return undefined
}

function coverImageName(header: MobiHeader, images: MobiImage[]): string | undefined {
  const offset = exthNumber(header, EXTH_COVER_OFFSET)
  if (offset === undefined || offset === 0xffffffff) return images[0]?.name
  return images.find((image) => image.reference === offset + 1)?.name ?? images[0]?.name
}

/* -------------------------------- markup -------------------------------- */

function splitIntoSections(markup: string, isKf8: boolean): string[] {
  // KF8 concatenates complete XHTML documents; MOBI 6 uses explicit page breaks.
  const raw = isKf8
    ? markup.split(/(?=<html[\s>])/i)
    : markup.split(/<mbp:pagebreak[^>]*>/i)

  const chunks = raw.map((chunk) => chunk.trim()).filter((chunk) => chunk.length > 0)
  if (chunks.length === 0) return []

  // Merge tiny fragments, then cap the total.
  const merged: string[] = []
  for (const chunk of chunks) {
    const last = merged[merged.length - 1]
    if (last !== undefined && last.length < MIN_SECTION_BYTES) merged[merged.length - 1] = `${last}\n${chunk}`
    else merged.push(chunk)
  }

  if (merged.length <= MAX_SECTIONS) return merged

  const perSection = Math.ceil(merged.length / MAX_SECTIONS)
  const capped: string[] = []
  for (let i = 0; i < merged.length; i += perSection) {
    capped.push(merged.slice(i, i + perSection).join('\n'))
  }
  return capped
}

/** Kindle encodes embedded-resource ids in base32 (0-9 then A-V). */
function decodeBase32(token: string): number | undefined {
  let value = 0
  for (const character of token.toUpperCase()) {
    const digit = '0123456789ABCDEFGHIJKLMNOPQRSTUV'.indexOf(character)
    if (digit === -1) return undefined
    value = value * 32 + digit
  }
  return value
}

function rewriteMarkup(section: string, images: MobiImage[]): string {
  const byReference = new Map(images.map((image) => [image.reference, image]))

  let body = section
    // MOBI 6 references images by record number.
    .replace(/<img\b[^>]*>/gi, (tag) => {
      const match = /(?:hi|lo)?recindex\s*=\s*["']?(\d+)["']?/i.exec(tag)
      if (!match) return tag
      const image = byReference.get(Number.parseInt(match[1]!, 10))
      return image ? `<img src="images/${image.name}" alt=""/>` : ''
    })
    // KF8 references them with a kindle:embed URI, base32-encoded.
    .replace(/kindle:embed:([0-9A-Za-z]+)(\?[^"']*)?/gi, (whole, token: string) => {
      const reference = decodeBase32(token)
      const image = reference === undefined ? undefined : byReference.get(reference)
      return image ? `images/${image.name}` : whole
    })
    // These never resolve to anything we can navigate to.
    .replace(/\s(?:filepos|recindex|hirecindex|lorecindex)\s*=\s*["']?[\w-]+["']?/gi, '')
    .replace(/<\/?mbp:[^>]*>/gi, '')

  // Strip any document scaffolding: each section is re-wrapped below.
  body = body
    .replace(/<\?xml[^>]*\?>/gi, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<\/?(?:html|head|body)\b[^>]*>/gi, '')
    .replace(/<(title|style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(?:link|meta)\b[^>]*>/gi, '')

  return body.trim()
}

/* ------------------------------ EPUB assembly ------------------------------ */

function buildEpub(input: {
  title: string
  creator?: string
  publisher?: string
  sections: string[]
  images: MobiImage[]
  coverName?: string
}): Uint8Array {
  const { title, creator, publisher, sections, images, coverName } = input

  const files: Record<string, Uint8Array> = {
    'mimetype': strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`),
    'OEBPS/style.css': strToU8(
      'img { max-width: 100%; height: auto; } body { font-family: serif; } ' +
        'h1, h2, h3 { line-height: 1.2; }',
    ),
  }

  const names = sections.map((_, index) => `part${String(index + 1).padStart(4, '0')}.html`)
  sections.forEach((section, index) => {
    files[`OEBPS/${names[index]!}`] = strToU8(`<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="utf-8"/>
<title>${escapeXml(title)}</title>
<link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
${section}
</body></html>`)
  })

  for (const image of images) files[`OEBPS/images/${image.name}`] = image.bytes

  const manifest = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="css" href="style.css" media-type="text/css"/>',
    ...names.map((name, index) => `<item id="s${index}" href="${name}" media-type="text/html"/>`),
    ...images.map(
      (image, index) =>
        `<item id="i${index}" href="images/${image.name}" media-type="${image.mimeType}"` +
        `${image.name === coverName ? ' properties="cover-image"' : ''}/>`,
    ),
  ].join('\n    ')

  files['OEBPS/package.opf'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${escapeXml(title)}</dc:title>
    ${creator ? `<dc:creator>${escapeXml(creator)}</dc:creator>` : ''}
    ${publisher ? `<dc:publisher>${escapeXml(publisher)}</dc:publisher>` : ''}
    <dc:identifier id="bookid">mobi:${escapeXml(title)}</dc:identifier>
    <dc:language>en</dc:language>
    <meta property="rendition:layout">reflowable</meta>
  </metadata>
  <manifest>
    ${manifest}
  </manifest>
  <spine>
    ${names.map((_, index) => `<itemref idref="s${index}"/>`).join('\n    ')}
  </spine>
</package>`)

  files['OEBPS/nav.xhtml'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head><body>
<nav epub:type="toc"><ol>
${names.map((name, index) => `<li><a href="${name}">Section ${index + 1}</a></li>`).join('\n')}
</ol></nav>
</body></html>`)

  return zipSync(files)
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export { MobiError, imageSize }
