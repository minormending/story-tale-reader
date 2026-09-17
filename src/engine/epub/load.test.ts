import { describe, it, expect } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { readFileSync, existsSync } from 'node:fs'
import { loadEpub } from './load'
import { DrmError } from './ocf'
import { bufferSource } from '../zip/reader'
import { buildSpreads } from '../layout/spread'

const REFERENCE_BOOK = 'corpus/local/amelia-bedelia-birds.epub'

const CONTAINER = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`

function page(n: number) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head>
<meta name="viewport" content="width=800, height=1200"/></head>
<body><div class="p"><img src="images/p${n}.jpg" alt=""/><div class="t"><p>Page ${n}</p></div></div></body></html>`
}

function buildFixture(
  options: { spread?: string; pageList?: boolean; layout?: string; extra?: Record<string, string> } = {},
) {
  const { spread = 'landscape', pageList = true, layout = 'pre-paginated', extra = {} } = options
  const count = 6
  const files: Record<string, Uint8Array> = {
    'mimetype': strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(CONTAINER),
  }
  for (let i = 0; i < count; i++) files[`OEBPS/p${i}.xhtml`] = strToU8(page(i))

  const manifest = Array.from({ length: count }, (_, i) =>
    `<item id="p${i}" href="p${i}.xhtml" media-type="application/xhtml+xml"/>`).join('')
  const spineRefs = Array.from({ length: count }, (_, i) => `<itemref idref="p${i}"/>`).join('')

  files['OEBPS/package.opf'] = strToU8(`<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Fixture Book</dc:title><dc:creator>A. Author</dc:creator>
    <dc:identifier id="bookid">urn:uuid:fixture</dc:identifier><dc:language>en</dc:language>
    <meta property="rendition:layout">${layout}</meta>
    <meta property="rendition:spread">${spread}</meta>
  </metadata>
  <manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${manifest}</manifest>
  <spine>${spineRefs}</spine>
</package>`)

  const pageEntries = pageList
    ? Array.from({ length: count }, (_, i) => `<li><a href="p${i}.xhtml">${i + 1}</a></li>`).join('')
    : ''
  files['OEBPS/nav.xhtml'] = strToU8(`<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body>
<nav epub:type="toc"><ol><li><a href="p0.xhtml">Start</a></li></ol></nav>
${pageList ? `<nav epub:type="page-list"><ol>${pageEntries}</ol></nav>` : ''}
</body></html>`)

  for (const [name, body] of Object.entries(extra)) files[name] = strToU8(body)
  return zipSync(files)
}

describe('loadEpub', () => {
  it('parses metadata, layout, spread policy and viewports', async () => {
    const { book } = await loadEpub(bufferSource(buildFixture()))
    expect(book.metadata.title).toBe('Fixture Book')
    expect(book.metadata.creator).toBe('A. Author')
    expect(book.metadata.identifier).toBe('urn:uuid:fixture')
    expect(book.layout).toBe('pre-paginated')
    expect(book.layoutInferred).toBe(false)
    expect(book.spread).toBe('landscape')
    expect(book.direction).toBe('ltr')
    expect(book.pages.length).toBe(6)
    expect(book.pages[0]!.viewport).toEqual({ width: 800, height: 1200 })
    expect(book.nav[0]!.label).toBe('Start')
  })

  it('infers fixed layout from viewport coverage when nothing declares it', async () => {
    const { book } = await loadEpub(bufferSource(buildFixture({ layout: '' })))
    expect(book.layout).toBe('pre-paginated')
    expect(book.layoutInferred).toBe(true)
  })

  it('carries printed page labels through to pages', async () => {
    const { book } = await loadEpub(bufferSource(buildFixture()))
    expect(book.pages.map((p) => p.printedPage)).toEqual(['1', '2', '3', '4', '5', '6'])
  })

  it('applies a spread shift override', async () => {
    const source = bufferSource(buildFixture())
    const plain = await loadEpub(source)
    const shifted = await loadEpub(source, { spreadShift: 1 })
    expect(plain.book.pages.map((p) => p.spreadSide))
      .toEqual(['right', 'left', 'right', 'left', 'right', 'left'])
    expect(shifted.book.pages.map((p) => p.spreadSide))
      .toEqual(['left', 'right', 'left', 'right', 'left', 'right'])
  })

  it('rejects encrypted books instead of rendering garbage', async () => {
    const files: Record<string, Uint8Array> = {
      'META-INF/container.xml': strToU8(CONTAINER),
      'META-INF/rights.xml': strToU8('<rights/>'),
    }
    await expect(loadEpub(bufferSource(zipSync(files)))).rejects.toThrow(DrmError)
  })

  it('does not mistake font obfuscation for DRM', async () => {
    const encryption = `<?xml version="1.0"?>
<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#">
    <EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/>
    <CipherData><CipherReference URI="OEBPS/fonts/x.woff"/></CipherData>
  </EncryptedData></encryption>`
    const { book } = await loadEpub(
      bufferSource(buildFixture({ extra: { 'META-INF/encryption.xml': encryption } })),
    )
    expect(book.metadata.title).toBe('Fixture Book')
  })

  it('rejects a book that encrypts its content documents', async () => {
    const encryption = `<?xml version="1.0"?>
<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#">
    <EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes256-cbc"/>
    <CipherData><CipherReference URI="OEBPS/p0.xhtml"/></CipherData>
  </EncryptedData></encryption>`
    await expect(
      loadEpub(bufferSource(buildFixture({ extra: { 'META-INF/encryption.xml': encryption } }))),
    ).rejects.toThrow(DrmError)
  })
})

describe.skipIf(!existsSync(REFERENCE_BOOK))('loadEpub against the reference book', () => {
  it('recognises the fixed layout, viewport, spread policy and narration', async () => {
    const { book } = await loadEpub(bufferSource(readFileSync(REFERENCE_BOOK)))

    expect(book.metadata.title).toBe('Amelia Bedelia Is for the Birds')
    expect(book.metadata.creator).toBe('Herman Parish')
    expect(book.metadata.identifier).toBe('9780062334268')
    expect(book.layout).toBe('pre-paginated')
    expect(book.layoutInferred).toBe(false)
    expect(book.spread).toBe('landscape')
    expect(book.pages.length).toBe(35)
    expect(book.hasMediaOverlays).toBe(true)
    expect(book.coverPath).toBe('OEBPS/images/cover.jpg')

    // Every content page is the same 800x1200 portrait viewport.
    for (const p of book.pages) expect(p.viewport).toEqual({ width: 800, height: 1200 })
  })

  it('pairs spreads from the page-list so page 12 faces page 13', async () => {
    const { book } = await loadEpub(bufferSource(readFileSync(REFERENCE_BOOK)))
    const spreads = buildSpreads(book.pages, book.direction, true)

    const byPrinted = (n: string) => book.pages.find((p) => p.printedPage === n)!
    const twelve = byPrinted('12')
    const thirteen = byPrinted('13')
    expect(twelve.path).toBe('OEBPS/page012.xhtml')
    expect(thirteen.path).toBe('OEBPS/page013.xhtml')

    const spread = spreads.find((s) => s.left?.path === 'OEBPS/page012.xhtml')
    expect(spread, 'page 12 should be a left-hand page').toBeDefined()
    expect(spread!.right?.path).toBe('OEBPS/page013.xhtml')

    // The cover stands alone rather than stealing the first title page.
    expect(spreads[0]!.right?.path).toBe('OEBPS/cover.xhtml')
    expect(spreads[0]!.left).toBeUndefined()
    expect(spreads[1]!.left?.path).toBe('OEBPS/titlepageleft.xhtml')
    expect(spreads[1]!.right?.path).toBe('OEBPS/titlepageright.xhtml')
  })

  it('links each narrated page to its SMIL overlay', async () => {
    const { book } = await loadEpub(bufferSource(readFileSync(REFERENCE_BOOK)))
    const twelve = book.pages.find((p) => p.path === 'OEBPS/page012.xhtml')!
    expect(twelve.overlayPath).toBe('OEBPS/smil/page012.smil')
    // 27 of the 35 spine documents are narrated; pages 4, 15 and 27 and the
    // end matter carry no overlay.
    expect(book.pages.filter((p) => p.overlayPath).length).toBe(27)
  })
})
