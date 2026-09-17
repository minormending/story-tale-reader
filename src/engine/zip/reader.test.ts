import { describe, it, expect } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { readFileSync, existsSync } from 'node:fs'
import { ZipArchive, bufferSource, ZipError } from './reader'

const REFERENCE_BOOK = 'corpus/local/amelia-bedelia-birds.epub'

function makeZip(files: Record<string, string>, level: 0 | 6 = 6) {
  const input: Record<string, Uint8Array> = {}
  for (const [name, body] of Object.entries(files)) input[name] = strToU8(body)
  return zipSync(input, { level })
}

describe('ZipArchive', () => {
  it('lists and reads deflated entries', async () => {
    const zip = makeZip({ 'a.txt': 'hello', 'dir/b.txt': 'world'.repeat(200) })
    const archive = await ZipArchive.open(bufferSource(zip))
    expect(archive.list().sort()).toEqual(['a.txt', 'dir/b.txt'])
    expect(await archive.readText('a.txt')).toBe('hello')
    expect(await archive.readText('dir/b.txt')).toBe('world'.repeat(200))
  })

  it('reads stored (uncompressed) entries', async () => {
    const archive = await ZipArchive.open(bufferSource(makeZip({ 'mimetype': 'application/epub+zip' }, 0)))
    expect(await archive.readText('mimetype')).toBe('application/epub+zip')
  })

  it('normalises leading ./ and / in lookups', async () => {
    const archive = await ZipArchive.open(bufferSource(makeZip({ 'OEBPS/x.txt': 'v' })))
    expect(await archive.readText('/OEBPS/x.txt')).toBe('v')
    expect(await archive.readText('./OEBPS/x.txt')).toBe('v')
    expect(archive.has('OEBPS/x.txt')).toBe(true)
  })

  it('throws a typed error for a missing entry', async () => {
    const archive = await ZipArchive.open(bufferSource(makeZip({ 'a.txt': 'x' })))
    await expect(archive.read('nope.txt')).rejects.toThrow(ZipError)
  })

  it('rejects data that is not a ZIP', async () => {
    await expect(ZipArchive.open(bufferSource(new Uint8Array(200)))).rejects.toThrow(ZipError)
  })

  it('serves repeat reads from cache as identical bytes', async () => {
    const archive = await ZipArchive.open(bufferSource(makeZip({ 'a.txt': 'cached' })))
    const first = await archive.read('a.txt')
    expect(await archive.read('a.txt')).toBe(first)
  })
})

describe.skipIf(!existsSync(REFERENCE_BOOK))('ZipArchive against the reference book', () => {
  it('opens the real EPUB and reads its container, package and a page image', async () => {
    const archive = await ZipArchive.open(bufferSource(readFileSync(REFERENCE_BOOK)))

    expect(await archive.readText('mimetype')).toBe('application/epub+zip')
    expect(await archive.readText('META-INF/container.xml')).toContain('OEBPS/package.opf')

    const opf = await archive.readText('OEBPS/package.opf')
    expect(opf).toContain('pre-paginated')

    // A real deflated JPEG round-trips to its exact uncompressed size.
    const jpeg = await archive.read('OEBPS/images/page012.jpg')
    expect(jpeg[0]).toBe(0xff)
    expect(jpeg[1]).toBe(0xd8)
    expect(jpeg.byteLength).toBe(archive.entry('OEBPS/images/page012.jpg')!.uncompressedSize)

    expect(archive.list().length).toBe(129)
  })
})
