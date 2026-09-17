/**
 * PalmDB container parsing — the outer format of MOBI, AZW and AZW3 files.
 */

export interface PalmRecord {
  offset: number
  length: number
}

export interface PalmDatabase {
  name: string
  type: string
  creator: string
  records: PalmRecord[]
  bytes: Uint8Array
}

export class MobiError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MobiError'
  }
}

const latin1 = new TextDecoder('latin1')

export function parsePalmDatabase(bytes: Uint8Array): PalmDatabase {
  if (bytes.byteLength < 78) throw new MobiError('File is too small to be a MOBI book')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  const name = latin1.decode(bytes.subarray(0, 32)).replace(/\0.*$/, '')
  const type = latin1.decode(bytes.subarray(60, 64))
  const creator = latin1.decode(bytes.subarray(64, 68))
  const count = view.getUint16(76, false)

  if (78 + count * 8 > bytes.byteLength) throw new MobiError('MOBI record table is truncated')

  const offsets: number[] = []
  for (let i = 0; i < count; i++) offsets.push(view.getUint32(78 + i * 8, false))

  const records: PalmRecord[] = offsets.map((offset, index) => ({
    offset,
    length: (offsets[index + 1] ?? bytes.byteLength) - offset,
  }))

  return { name, type, creator, records, bytes }
}

export function recordBytes(db: PalmDatabase, index: number): Uint8Array {
  const record = db.records[index]
  if (!record || record.offset < 0 || record.length < 0) {
    throw new MobiError(`MOBI record ${index} is missing`)
  }
  return db.bytes.subarray(record.offset, record.offset + record.length)
}
