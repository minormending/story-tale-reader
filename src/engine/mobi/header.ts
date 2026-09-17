/** MOBI / KF8 header parsing (SPEC.md §8.2). */

import { MobiError, recordBytes, type PalmDatabase } from './palmdb'

export interface MobiHeader {
  /** Index of the record this header was read from. */
  baseRecord: number
  compression: number
  textLength: number
  textRecordCount: number
  encryptionType: number
  mobiType: number
  encoding: number
  fileVersion: number
  firstNonBookIndex: number
  firstImageIndex: number
  fullName?: string
  extraDataFlags: number
  exth: Map<number, Uint8Array[]>
}

const latin1 = new TextDecoder('latin1')

/** EXTH record types worth reading. */
export const EXTH_AUTHOR = 100
export const EXTH_PUBLISHER = 101
export const EXTH_LANGUAGE = 524
export const EXTH_KF8_BOUNDARY = 121
export const EXTH_COVER_OFFSET = 201

export function parseMobiHeader(db: PalmDatabase, baseRecord: number): MobiHeader {
  const bytes = recordBytes(db, baseRecord)
  if (bytes.byteLength < 16) throw new MobiError('MOBI header record is truncated')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  const compression = view.getUint16(0, false)
  const textLength = view.getUint32(4, false)
  const textRecordCount = view.getUint16(8, false)
  const encryptionType = view.getUint16(12, false)

  const header: MobiHeader = {
    baseRecord,
    compression,
    textLength,
    textRecordCount,
    encryptionType,
    mobiType: 2,
    encoding: 1252,
    fileVersion: 5,
    firstNonBookIndex: 0,
    firstImageIndex: 0,
    extraDataFlags: 0,
    exth: new Map(),
  }

  const hasMobi = bytes.byteLength > 20 && latin1.decode(bytes.subarray(16, 20)) === 'MOBI'
  if (!hasMobi) return header

  const headerLength = view.getUint32(20, false)
  header.mobiType = view.getUint32(24, false)
  header.encoding = view.getUint32(28, false)
  header.fileVersion = view.getUint32(36, false)

  const read = (offset: number): number =>
    offset + 4 <= bytes.byteLength ? view.getUint32(offset, false) : 0

  header.firstNonBookIndex = read(0x50)
  header.firstImageIndex = read(0x6c)

  const nameOffset = read(0x54)
  const nameLength = read(0x58)
  if (nameOffset && nameLength && nameOffset + nameLength <= bytes.byteLength) {
    header.fullName = decodeText(bytes.subarray(nameOffset, nameOffset + nameLength), header.encoding)
  }

  // Trailing-entry flags. Without honouring these the tail of every text record is
  // treated as content and the book fills with binary rubbish.
  if (headerLength >= 0xe4 && 0xf2 + 2 <= bytes.byteLength) {
    header.extraDataFlags = view.getUint16(0xf2, false)
  }

  const exthFlags = read(0x80)
  if (exthFlags & 0x40) {
    header.exth = parseExth(bytes, 16 + headerLength)
  }

  return header
}

function parseExth(bytes: Uint8Array, offset: number): Map<number, Uint8Array[]> {
  const out = new Map<number, Uint8Array[]>()
  if (offset + 12 > bytes.byteLength) return out
  if (latin1.decode(bytes.subarray(offset, offset + 4)) !== 'EXTH') return out

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const count = view.getUint32(offset + 8, false)

  let cursor = offset + 12
  for (let i = 0; i < count && cursor + 8 <= bytes.byteLength; i++) {
    const type = view.getUint32(cursor, false)
    const length = view.getUint32(cursor + 4, false)
    if (length < 8 || cursor + length > bytes.byteLength) break
    const data = bytes.subarray(cursor + 8, cursor + length)
    const bucket = out.get(type)
    if (bucket) bucket.push(data)
    else out.set(type, [data])
    cursor += length
  }

  return out
}

export function exthString(header: MobiHeader, type: number): string | undefined {
  const value = header.exth.get(type)?.[0]
  if (!value) return undefined
  const text = decodeText(value, header.encoding).trim()
  return text || undefined
}

export function exthNumber(header: MobiHeader, type: number): number | undefined {
  const value = header.exth.get(type)?.[0]
  if (!value || value.byteLength < 4) return undefined
  return new DataView(value.buffer, value.byteOffset, value.byteLength).getUint32(0, false)
}

export function decodeText(bytes: Uint8Array, encoding: number): string {
  const label = encoding === 65001 ? 'utf-8' : 'windows-1252'
  try {
    return new TextDecoder(label).decode(bytes)
  } catch {
    return latin1.decode(bytes)
  }
}

/**
 * Number of trailing bytes to drop from a text record.
 *
 * Records can carry multibyte-overlap and index data after the text; the flags say
 * which are present, and each is a backwards variable-length integer.
 */
export function trailingByteCount(record: Uint8Array, flags: number): number {
  let total = 0

  for (let bit = 1; bit < 16; bit++) {
    if (!(flags & (1 << bit))) continue
    total += backwardsVarintSize(record, record.byteLength - total)
  }

  // Bit 0 is the multibyte-overlap count, stored in the low two bits of one byte.
  if (flags & 1) {
    const index = record.byteLength - total - 1
    if (index >= 0) total += (record[index]! & 0x3) + 1
  }

  return Math.min(total, record.byteLength)
}

/** Size of a variable-length integer that ends at `end`, read backwards. */
function backwardsVarintSize(record: Uint8Array, end: number): number {
  let value = 0
  let bytesConsumed = 0

  for (let i = end - 1; i >= 0 && bytesConsumed < 4; i--) {
    const byte = record[i]!
    bytesConsumed++
    value = (value << 7) | (byte & 0x7f)
    // The final byte of the sequence (first one encountered going backwards) has
    // the high bit set.
    if (byte & 0x80) break
  }

  return value === 0 ? bytesConsumed : value
}
