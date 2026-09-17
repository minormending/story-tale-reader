/**
 * Write a small, valid MOBI 6 fixture so the import -> render path can be exercised
 * in a browser, not only in unit tests. Uncompressed (compression type 1) with one
 * embedded JPEG referenced by recindex.
 */
import { writeFile } from 'node:fs/promises'
import sharp from 'sharp'

const HEADER_LENGTH = 232
const RECORD_SIZE = 4096
const enc = new TextEncoder()

const TITLE = 'A Nest on the Slide'
const AUTHOR = 'Story Tale Reader fixtures'

const paragraphs = [
  'The robin built her nest on the top of the slide, which was, everyone agreed, a most inconvenient place for a nest.',
  'Amelia Bedelia looked at the nest for a long time. Then she looked at the slide. Then she looked at the nest again.',
  'A slide is for sliding, she thought. But a nest is for sitting. And you cannot do both at once, not properly.',
]

const html =
  '<html><head><guide></guide></head><body>' +
  '<h1>Chapter One</h1>' +
  paragraphs.map((p) => `<p>${p}</p>`).join('') +
  '<img recindex="00001" width="400"/>' +
  '<mbp:pagebreak/>' +
  '<h1>Chapter Two</h1>' +
  paragraphs.slice().reverse().map((p) => `<p>${p}</p>`).join('') +
  '</body></html>'

const picture = await sharp(
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="260">
    <rect width="400" height="260" fill="#9ad1d4"/>
    <circle cx="200" cy="130" r="80" fill="#fffaf0"/>
    <text x="200" y="145" font-family="Helvetica,Arial" font-size="36" text-anchor="middle" fill="#2b2b33">nest</text>
  </svg>`),
).jpeg({ quality: 80 }).toBuffer()

const images = [new Uint8Array(picture)]
const text = enc.encode(html)

const textRecords = []
for (let o = 0; o < text.byteLength; o += RECORD_SIZE) {
  textRecords.push(text.subarray(o, Math.min(o + RECORD_SIZE, text.byteLength)))
}

const exth = [
  { type: 100, data: enc.encode(AUTHOR) },
  { type: 201, data: Uint8Array.from([0, 0, 0, 0]) },
]
const exthLength = 12 + exth.reduce((n, e) => n + 8 + e.data.byteLength, 0)
const exthStart = 16 + HEADER_LENGTH
const nameBytes = enc.encode(TITLE)
const nameOffset = exthStart + exthLength

const record0 = new Uint8Array(nameOffset + nameBytes.byteLength + 2)
const v = new DataView(record0.buffer)
v.setUint16(0, 1, false)                       // compression: none
v.setUint32(4, text.byteLength, false)
v.setUint16(8, textRecords.length, false)
v.setUint16(10, RECORD_SIZE, false)
v.setUint16(12, 0, false)                      // no encryption
record0.set(enc.encode('MOBI'), 16)
v.setUint32(20, HEADER_LENGTH, false)
v.setUint32(24, 2, false)
v.setUint32(28, 65001, false)                  // UTF-8
v.setUint32(32, 4242, false)
v.setUint32(36, 6, false)
v.setUint32(0x50, 1 + textRecords.length + images.length, false)
v.setUint32(0x54, nameOffset, false)
v.setUint32(0x58, nameBytes.byteLength, false)
v.setUint32(0x6c, 1 + textRecords.length, false)
v.setUint32(0x80, 0x40, false)                 // EXTH present
v.setUint16(0xf2, 0, false)
record0.set(enc.encode('EXTH'), exthStart)
v.setUint32(exthStart + 4, exthLength, false)
v.setUint32(exthStart + 8, exth.length, false)
let cursor = exthStart + 12
for (const entry of exth) {
  v.setUint32(cursor, entry.type, false)
  v.setUint32(cursor + 4, 8 + entry.data.byteLength, false)
  record0.set(entry.data, cursor + 8)
  cursor += 8 + entry.data.byteLength
}
record0.set(nameBytes, nameOffset)

const records = [record0, ...textRecords, ...images]
const headerSize = 78 + records.length * 8
const total = headerSize + records.reduce((n, r) => n + r.byteLength, 0)

const out = new Uint8Array(total)
const ov = new DataView(out.buffer)
out.set(enc.encode(TITLE.slice(0, 31)), 0)
out.set(enc.encode('BOOK'), 60)
out.set(enc.encode('MOBI'), 64)
ov.setUint16(76, records.length, false)

let offset = headerSize
records.forEach((record, index) => {
  ov.setUint32(78 + index * 8, offset, false)
  out.set(record, offset)
  offset += record.byteLength
})

await writeFile('corpus/fixtures/nest-on-the-slide.mobi', out)
console.log('wrote corpus/fixtures/nest-on-the-slide.mobi')
