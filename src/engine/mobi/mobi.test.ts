import { describe, it, expect } from 'vitest'
import { decompressPalmDoc } from './palmdoc'
import { parsePalmDatabase, MobiError } from './palmdb'
import { parseMobiHeader, trailingByteCount, exthString } from './header'
import { loadMobi } from './load'
import { DrmError } from '../epub/ocf'
import { detectFormat } from '../format'

/* ------------------------- a synthetic MOBI builder ------------------------- */

const HEADER_LENGTH = 232
const RECORD_SIZE = 4096

function be32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]
}
interface MobiOptions {
  title: string
  author?: string
  html: string
  images?: Uint8Array[]
  compression?: 1 | 2 | 17480
  encryption?: number
}

function buildMobi(options: MobiOptions): Uint8Array {
  const { title, author, html, images = [], compression = 1, encryption = 0 } = options
  const text = new TextEncoder().encode(html)

  const textRecords: Uint8Array[] = []
  for (let offset = 0; offset < text.byteLength; offset += RECORD_SIZE) {
    textRecords.push(text.subarray(offset, Math.min(offset + RECORD_SIZE, text.byteLength)))
  }
  if (textRecords.length === 0) textRecords.push(new Uint8Array(0))

  // --- record 0: PalmDOC header + MOBI header + EXTH + full name ---
  const exthEntries: Array<{ type: number; data: Uint8Array }> = []
  if (author) exthEntries.push({ type: 100, data: new TextEncoder().encode(author) })
  if (images.length > 0) exthEntries.push({ type: 201, data: Uint8Array.from(be32(0)) })

  const exthBodyLength = exthEntries.reduce((sum, entry) => sum + 8 + entry.data.byteLength, 0)
  const exthLength = 12 + exthBodyLength
  const exthStart = 16 + HEADER_LENGTH
  const nameBytes = new TextEncoder().encode(title)
  const nameOffset = exthStart + exthLength

  const record0 = new Uint8Array(nameOffset + nameBytes.byteLength + 2)
  const view = new DataView(record0.buffer)

  view.setUint16(0, compression, false)
  view.setUint32(4, text.byteLength, false)
  view.setUint16(8, textRecords.length, false)
  view.setUint16(10, RECORD_SIZE, false)
  view.setUint16(12, encryption, false)

  record0.set(new TextEncoder().encode('MOBI'), 16)
  view.setUint32(20, HEADER_LENGTH, false)
  view.setUint32(24, 2, false) // mobi type: book
  view.setUint32(28, 65001, false) // UTF-8
  view.setUint32(32, 1234, false)
  view.setUint32(36, 6, false) // file version
  view.setUint32(0x50, 1 + textRecords.length + images.length, false) // first non-book
  view.setUint32(0x54, nameOffset, false)
  view.setUint32(0x58, nameBytes.byteLength, false)
  view.setUint32(0x6c, images.length > 0 ? 1 + textRecords.length : 0, false) // first image
  view.setUint32(0x80, 0x40, false) // EXTH present
  view.setUint16(0xf2, 0, false) // no trailing entries

  record0.set(new TextEncoder().encode('EXTH'), exthStart)
  view.setUint32(exthStart + 4, exthLength, false)
  view.setUint32(exthStart + 8, exthEntries.length, false)
  let cursor = exthStart + 12
  for (const entry of exthEntries) {
    view.setUint32(cursor, entry.type, false)
    view.setUint32(cursor + 4, 8 + entry.data.byteLength, false)
    record0.set(entry.data, cursor + 8)
    cursor += 8 + entry.data.byteLength
  }
  record0.set(nameBytes, nameOffset)

  // --- assemble the PalmDB ---
  const records = [record0, ...textRecords, ...images]
  const headerSize = 78 + records.length * 8
  const total = headerSize + records.reduce((sum, record) => sum + record.byteLength, 0)

  const out = new Uint8Array(total)
  const outView = new DataView(out.buffer)
  out.set(new TextEncoder().encode(title.slice(0, 31)), 0)
  out.set(new TextEncoder().encode('BOOK'), 60)
  out.set(new TextEncoder().encode('MOBI'), 64)
  outView.setUint16(76, records.length, false)

  let offset = headerSize
  records.forEach((record, index) => {
    outView.setUint32(78 + index * 8, offset, false)
    out.set(record, offset)
    offset += record.byteLength
  })

  return out
}

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0])

/* --------------------------------- tests --------------------------------- */

describe('decompressPalmDoc', () => {
  it('passes literals through', () => {
    expect([...decompressPalmDoc(Uint8Array.from([0x41, 0x42, 0x43]))]).toEqual([0x41, 0x42, 0x43])
  })

  it('copies a literal run', () => {
    expect([...decompressPalmDoc(Uint8Array.from([0x02, 0x00, 0x01, 0x41]))]).toEqual([0x00, 0x01, 0x41])
  })

  it('expands a space-plus-letter byte', () => {
    expect([...decompressPalmDoc(Uint8Array.from([0xc1]))]).toEqual([0x20, 0x41])
  })

  it('resolves a back-reference', () => {
    // "ABCDEFGH" then a reference 8 back, 3 long -> "ABCDEFGHABC"
    const input = Uint8Array.from([0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x80, 0x40])
    expect(new TextDecoder().decode(decompressPalmDoc(input))).toBe('ABCDEFGHABC')
  })

  it('ignores a back-reference that points before the start', () => {
    expect([...decompressPalmDoc(Uint8Array.from([0x80, 0x40]))]).toEqual([])
  })
})

describe('trailingByteCount', () => {
  it('is zero when no flags are set', () => {
    expect(trailingByteCount(Uint8Array.from([1, 2, 3, 4]), 0)).toBe(0)
  })

  it('reads the multibyte-overlap count from the low two bits', () => {
    // flags bit 0 set; last byte 0x02 -> (2 & 3) + 1 = 3 trailing bytes
    expect(trailingByteCount(Uint8Array.from([1, 2, 3, 4, 0x02]), 1)).toBe(3)
  })

  it('never claims more bytes than the record holds', () => {
    expect(trailingByteCount(Uint8Array.from([0xff]), 0xffff)).toBeLessThanOrEqual(1)
  })
})

describe('PalmDB and MOBI headers', () => {
  const file = buildMobi({ title: 'Test Book', author: 'A. Writer', html: '<html><body><p>Hi</p></body></html>' })

  it('is detected as a MOBI by its container signature', () => {
    expect(detectFormat(file.subarray(0, 128))).toBe('mobi')
  })

  it('parses the record table', () => {
    const db = parsePalmDatabase(file)
    expect(db.type).toBe('BOOK')
    expect(db.creator).toBe('MOBI')
    expect(db.records.length).toBeGreaterThan(1)
  })

  it('parses the MOBI header and EXTH', () => {
    const header = parseMobiHeader(parsePalmDatabase(file), 0)
    expect(header.fullName).toBe('Test Book')
    expect(header.encoding).toBe(65001)
    expect(exthString(header, 100)).toBe('A. Writer')
  })

  it('rejects a file that is too small', () => {
    expect(() => parsePalmDatabase(new Uint8Array(10))).toThrow(MobiError)
  })
})

describe('loadMobi', () => {
  it('unpacks a book into a readable EPUB', async () => {
    const html =
      '<html><body><h1>Chapter One</h1><p>The robin built her nest.</p>' +
      '<mbp:pagebreak/><h1>Chapter Two</h1><p>Amelia Bedelia looked at the slide.</p></body></html>'
    const { book, archive } = await loadMobi(
      buildMobi({ title: 'Nest Book', author: 'H. Parish', html }),
      'ignored',
    )

    expect(book.format).toBe('mobi')
    expect(book.metadata.title).toBe('Nest Book')
    expect(book.metadata.creator).toBe('H. Parish')
    expect(book.layout).toBe('reflowable')
    expect(book.pages.length).toBeGreaterThanOrEqual(1)

    const text = await archive.readText(book.pages[0]!.path)
    expect(text).toContain('The robin built her nest.')
    // Document scaffolding from the MOBI markup is stripped, not nested.
    expect(text.match(/<body/gi)?.length).toBe(1)
    expect(text).not.toContain('mbp:pagebreak')
  })

  it('extracts images and rewrites recindex references', async () => {
    const html = '<html><body><p>Look:</p><img recindex="00001" width="100"/></body></html>'
    const { book, archive } = await loadMobi(
      buildMobi({ title: 'Picture Book', html, images: [JPEG] }),
      'ignored',
    )

    const text = await archive.readText(book.pages[0]!.path)
    expect(text).toContain('src="images/img00001.jpg"')
    expect(text).not.toContain('recindex')
    expect(archive.has('OEBPS/images/img00001.jpg')).toBe(true)
    expect(book.coverPath).toBe('OEBPS/images/img00001.jpg')
  })

  it('rewrites KF8 kindle:embed references, which are base32', async () => {
    // base32 "00001" is 1, so it points at the first image record.
    const html = '<html><body><img src="kindle:embed:00001?mime=image/jpeg"/></body></html>'
    const { book, archive } = await loadMobi(
      buildMobi({ title: 'KF8 Book', html, images: [JPEG] }),
      'ignored',
    )
    const text = await archive.readText(book.pages[0]!.path)
    expect(text).toContain('images/img00001.jpg')
    expect(text).not.toContain('kindle:embed')
  })

  it('reads a PalmDOC-compressed book', async () => {
    // "ABCDEFGH" + back-reference produces text the decompressor has to expand.
    const compressed = Uint8Array.from([
      ...new TextEncoder().encode('<html><body><p>ABCDEFGH'),
      0x80, 0x40,
      ...new TextEncoder().encode('</p></body></html>'),
    ])
    const expanded = decompressPalmDoc(compressed)
    const file = buildMobi({
      title: 'Compressed',
      html: new TextDecoder().decode(expanded),
      compression: 1,
    })
    const { archive, book } = await loadMobi(file, 'ignored')
    expect(await archive.readText(book.pages[0]!.path)).toContain('ABCDEFGHABC')
  })

  it('refuses a DRM-protected book rather than rendering rubbish', async () => {
    const file = buildMobi({ title: 'Locked', html: '<html><body>x</body></html>', encryption: 2 })
    await expect(loadMobi(file, 'ignored')).rejects.toThrow(DrmError)
  })

  it('refuses HUFF/CDIC compression with an explanation', async () => {
    const file = buildMobi({ title: 'Huff', html: '<html><body>x</body></html>', compression: 17480 })
    await expect(loadMobi(file, 'ignored')).rejects.toThrow(/HUFF\/CDIC/)
  })
})
