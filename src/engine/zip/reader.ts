/**
 * Random-access ZIP reader.
 *
 * EPUB, AZW3 and CBZ are all ZIP containers, and a picture book can run to
 * hundreds of megabytes. We parse the central directory once and inflate
 * individual entries on demand, so opening a book never expands the whole archive
 * into memory (SPEC.md §4.2).
 */

import { inflateSync } from 'fflate'

const SIG_EOCD = 0x06054b50
const SIG_EOCD64 = 0x06064b50
const SIG_EOCD64_LOCATOR = 0x07064b50
const SIG_CENTRAL = 0x02014b50
const SIG_LOCAL = 0x04034b50

const U32_MAX = 0xffffffff

export interface ByteSource {
  readonly size: number
  slice(start: number, end: number): Promise<Uint8Array>
}

export function bufferSource(bytes: Uint8Array): ByteSource {
  return {
    size: bytes.byteLength,
    async slice(start, end) {
      return bytes.subarray(start, Math.min(end, bytes.byteLength))
    },
  }
}

export function blobSource(blob: Blob): ByteSource {
  return {
    size: blob.size,
    async slice(start, end) {
      const buf = await blob.slice(start, Math.min(end, blob.size)).arrayBuffer()
      return new Uint8Array(buf)
    },
  }
}

export interface ZipEntry {
  path: string
  compressionMethod: number
  compressedSize: number
  uncompressedSize: number
  localHeaderOffset: number
}

export class ZipError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ZipError'
  }
}

/** Inflated-entry cache budget. Picture-book pages get revisited constantly when paging. */
const CACHE_BUDGET_BYTES = 48 * 1024 * 1024

export class ZipArchive {
  private readonly cache = new Map<string, Uint8Array>()
  private cacheBytes = 0

  private constructor(
    private readonly source: ByteSource,
    private readonly entries: Map<string, ZipEntry>,
  ) {}

  static async open(source: ByteSource): Promise<ZipArchive> {
    const { centralOffset, centralSize, entryCount } = await locateCentralDirectory(source)
    const central = await source.slice(centralOffset, centralOffset + centralSize)
    const entries = parseCentralDirectory(central, entryCount)
    return new ZipArchive(source, entries)
  }

  list(): string[] {
    return [...this.entries.keys()]
  }

  has(path: string): boolean {
    return this.entries.has(normalize(path))
  }

  entry(path: string): ZipEntry | undefined {
    return this.entries.get(normalize(path))
  }

  async read(path: string): Promise<Uint8Array> {
    const key = normalize(path)
    const cached = this.cache.get(key)
    if (cached) return cached

    const entry = this.entries.get(key)
    if (!entry) throw new ZipError(`Entry not found in archive: ${path}`)

    // The local header repeats the name and extra fields, and its lengths may
    // differ from the central directory's — the data offset must come from here.
    const header = await this.source.slice(entry.localHeaderOffset, entry.localHeaderOffset + 30)
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength)
    if (view.getUint32(0, true) !== SIG_LOCAL) {
      throw new ZipError(`Bad local header for ${path}`)
    }
    const nameLen = view.getUint16(26, true)
    const extraLen = view.getUint16(28, true)
    const dataStart = entry.localHeaderOffset + 30 + nameLen + extraLen
    const raw = await this.source.slice(dataStart, dataStart + entry.compressedSize)

    let out: Uint8Array
    if (entry.compressionMethod === 0) {
      out = raw
    } else if (entry.compressionMethod === 8) {
      out = inflateSync(raw, { out: new Uint8Array(entry.uncompressedSize) })
    } else {
      throw new ZipError(`Unsupported compression method ${entry.compressionMethod} for ${path}`)
    }

    this.remember(key, out)
    return out
  }

  async readText(path: string): Promise<string> {
    return new TextDecoder('utf-8').decode(await this.read(path))
  }

  private remember(key: string, bytes: Uint8Array): void {
    if (bytes.byteLength > CACHE_BUDGET_BYTES / 2) return
    this.cache.set(key, bytes)
    this.cacheBytes += bytes.byteLength
    // Map preserves insertion order, so the first key is the oldest.
    while (this.cacheBytes > CACHE_BUDGET_BYTES) {
      const oldest = this.cache.keys().next()
      if (oldest.done) break
      const dropped = this.cache.get(oldest.value)
      this.cache.delete(oldest.value)
      this.cacheBytes -= dropped?.byteLength ?? 0
    }
  }
}

function normalize(path: string): string {
  return path.replace(/^\.?\//, '')
}

async function locateCentralDirectory(source: ByteSource) {
  // The EOCD sits at the very end unless there's an archive comment (max 65535).
  const tailLen = Math.min(source.size, 0xffff + 22)
  const tail = await source.slice(source.size - tailLen, source.size)
  const tailView = new DataView(tail.buffer, tail.byteOffset, tail.byteLength)

  let eocd = -1
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tailView.getUint32(i, true) === SIG_EOCD) {
      eocd = i
      break
    }
  }
  if (eocd === -1) throw new ZipError('Not a ZIP archive: end-of-central-directory record not found')

  let entryCount = tailView.getUint16(eocd + 10, true)
  let centralSize = tailView.getUint32(eocd + 12, true)
  let centralOffset = tailView.getUint32(eocd + 16, true)

  const needsZip64 =
    entryCount === 0xffff || centralSize === U32_MAX || centralOffset === U32_MAX
  if (needsZip64 && eocd >= 20) {
    const loc = eocd - 20
    if (tailView.getUint32(loc, true) === SIG_EOCD64_LOCATOR) {
      const eocd64Offset = Number(tailView.getBigUint64(loc + 8, true))
      const rec = await source.slice(eocd64Offset, eocd64Offset + 56)
      const recView = new DataView(rec.buffer, rec.byteOffset, rec.byteLength)
      if (recView.getUint32(0, true) === SIG_EOCD64) {
        entryCount = Number(recView.getBigUint64(32, true))
        centralSize = Number(recView.getBigUint64(40, true))
        centralOffset = Number(recView.getBigUint64(48, true))
      }
    }
  }

  return { centralOffset, centralSize, entryCount }
}

function parseCentralDirectory(central: Uint8Array, entryCount: number): Map<string, ZipEntry> {
  const view = new DataView(central.buffer, central.byteOffset, central.byteLength)
  const decoder = new TextDecoder('utf-8')
  const entries = new Map<string, ZipEntry>()

  let offset = 0
  for (let n = 0; n < entryCount && offset + 46 <= central.byteLength; n++) {
    if (view.getUint32(offset, true) !== SIG_CENTRAL) break

    const compressionMethod = view.getUint16(offset + 10, true)
    let compressedSize = view.getUint32(offset + 20, true)
    let uncompressedSize = view.getUint32(offset + 24, true)
    const nameLen = view.getUint16(offset + 28, true)
    const extraLen = view.getUint16(offset + 30, true)
    const commentLen = view.getUint16(offset + 32, true)
    let localHeaderOffset = view.getUint32(offset + 42, true)

    const nameStart = offset + 46
    const path = decoder.decode(central.subarray(nameStart, nameStart + nameLen))

    // ZIP64 extended information replaces whichever 32-bit fields were saturated,
    // in a fixed order, so they must be consumed conditionally.
    if (uncompressedSize === U32_MAX || compressedSize === U32_MAX || localHeaderOffset === U32_MAX) {
      const extraStart = nameStart + nameLen
      let p = extraStart
      const extraEnd = extraStart + extraLen
      while (p + 4 <= extraEnd) {
        const id = view.getUint16(p, true)
        const size = view.getUint16(p + 2, true)
        if (id === 0x0001) {
          let q = p + 4
          if (uncompressedSize === U32_MAX) { uncompressedSize = Number(view.getBigUint64(q, true)); q += 8 }
          if (compressedSize === U32_MAX) { compressedSize = Number(view.getBigUint64(q, true)); q += 8 }
          if (localHeaderOffset === U32_MAX) { localHeaderOffset = Number(view.getBigUint64(q, true)); q += 8 }
          break
        }
        p += 4 + size
      }
    }

    // Directory markers carry no data.
    if (!path.endsWith('/')) {
      entries.set(normalize(path), {
        path: normalize(path),
        compressionMethod,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
      })
    }

    offset = nameStart + nameLen + extraLen + commentLen
  }

  return entries
}
