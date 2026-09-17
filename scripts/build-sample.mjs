/**
 * Build the bundled sample book: a fixed-layout edition of Beatrix Potter's
 * "The Tale of Peter Rabbit" (1902).
 *
 * The work is in the public domain worldwide — published 1902, and Potter died in
 * 1943, so it cleared life+70 in 2014. The illustrations and text come from Project
 * Gutenberg ebook 14838, whose licence explicitly permits unrestricted use of the
 * public-domain work itself; all Project Gutenberg branding and boilerplate is
 * stripped, so none of the trademark terms apply to the result.
 *
 * Gutenberg's edition is reflowable — image, then the text beneath it — which is
 * exactly the shape this reader exists to improve on. Here each illustration is
 * composed onto a page and the text is positioned *on* that page, the way a real
 * fixed-layout picture book is authored, so the sample demonstrates what the reader
 * is for.
 *
 * Run with `npm run sample`. The built EPUB is committed; this only needs rerunning
 * if the layout changes.
 */
import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { unzipSync, zipSync, strToU8 } from 'fflate'
import sharp from 'sharp'

const SOURCE_URL = 'https://www.gutenberg.org/ebooks/14838.epub3.images'
const CACHE = '.cache/gutenberg-14838.epub'
const OUT = 'public/sample/peter-rabbit.epub'

const W = 800
const H = 1200
const PAPER = { r: 247, g: 241, b: 227, alpha: 1 } // warm cream, like aged paper

const ART_TOP = 80
const ART_MAX_W = 640
const ART_MAX_H = 700
const TEXT_TOP = 830
const TEXT_LEFT = 72
const TEXT_WIDTH = W - TEXT_LEFT * 2

/* ------------------------------- source text ------------------------------- */

async function sourceEpub() {
  try {
    await access(CACHE)
  } catch {
    console.log(`downloading ${SOURCE_URL}`)
    const response = await fetch(SOURCE_URL)
    if (!response.ok) throw new Error(`Gutenberg returned ${response.status}`)
    await mkdir('.cache', { recursive: true })
    await writeFile(CACHE, Buffer.from(await response.arrayBuffer()))
  }
  return unzipSync(new Uint8Array(await readFile(CACHE)))
}

function textOf(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&mdash;/g, '—')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractPages(files) {
  const name = Object.keys(files).find((path) => /14838-h-0\.htm\.xhtml$/.test(path))
  if (!name) throw new Error('Could not find the story document in the Gutenberg EPUB')

  let html = new TextDecoder().decode(files[name])
  // Drop Project Gutenberg's header and footer entirely.
  html = html.replace(/<(header|footer)[^>]*class="pg-boilerplate[\s\S]*?<\/\1>/g, '')

  const tokens = [...html.matchAll(/<img[^>]*src="([^"]+)"[^>]*>|<p[^>]*>([\s\S]*?)<\/p>/g)]
  const pages = []
  for (const token of tokens) {
    if (token[1]) {
      pages.push({ image: token[1], paragraphs: [] })
    } else {
      const text = textOf(token[2] ?? '')
      if (text && pages.length > 0) pages[pages.length - 1].paragraphs.push(text)
    }
  }
  return pages.filter((page) => files[`OEBPS/${page.image}`])
}

/* --------------------------------- layout --------------------------------- */

/** Shrink the type until the passage fits the space left under the illustration. */
function typeScale(characters) {
  if (characters <= 110) return { size: 34, leading: 50 }
  if (characters <= 200) return { size: 30, leading: 44 }
  if (characters <= 320) return { size: 26, leading: 38 }
  if (characters <= 460) return { size: 23, leading: 33 }
  return { size: 20, leading: 29 }
}

/**
 * Compose one page.
 *
 * A page carrying text keeps its illustration in the upper band so the words have
 * somewhere to sit. A page without text — the cover, the frontispiece — gets the
 * whole page and is centred, because anchoring it to the top left a large empty
 * expanse of cream underneath.
 */
async function composePage(imageBytes, { hasText }) {
  const maxWidth = hasText ? ART_MAX_W : W - 110
  const maxHeight = hasText ? ART_MAX_H : H - 150

  const art = sharp(Buffer.from(imageBytes))
  const meta = await art.metadata()
  const scale = Math.min(maxWidth / meta.width, maxHeight / meta.height, 1.6)
  const width = Math.round(meta.width * scale)
  const height = Math.round(meta.height * scale)

  const resized = await art.resize(width, height).toBuffer()
  return sharp({ create: { width: W, height: H, channels: 3, background: PAPER } })
    .composite([{
      input: resized,
      left: Math.round((W - width) / 2),
      top: hasText ? ART_TOP : Math.round((H - height) / 2),
    }])
    .jpeg({ quality: 82, progressive: true })
    .toBuffer()
}

function escapeXml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/* ---------------------------------- build ---------------------------------- */

const files = await sourceEpub()
const source = extractPages(files)
console.log(`found ${source.length} illustrated pages`)

const out = {
  'mimetype': strToU8('application/epub+zip'),
  'META-INF/container.xml': strToU8(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`),
}

const css = [
  `body { width: ${W}px; height: ${H}px; margin: 0; }`,
  `body > div { position: relative; overflow: hidden; width: ${W}px; height: ${H}px; }`,
  `img { position: absolute; top: 0; left: 0; width: ${W}px; height: ${H}px; }`,
  `p { position: absolute; left: ${TEXT_LEFT}px; width: ${TEXT_WIDTH}px; margin: 0;`,
  `    font-family: Georgia, "Iowan Old Style", serif; color: #2f2a21; text-align: left; }`,
  `.title { text-align: center; }`,
  `.title-main { font-size: 60px; line-height: 70px; top: 300px; }`,
  `.title-author { font-size: 30px; line-height: 40px; top: 470px; font-style: italic; }`,
  `.title-note { font-size: 20px; line-height: 28px; top: 1020px; color: #6b6153; }`,
].join('\n')
out['OEBPS/stylesheet.css'] = strToU8(css)

const pages = []

// --- cover ---
const coverKey = Object.keys(files).find((path) => /cover\.jpg$/.test(path))
out['OEBPS/images/cover.jpg'] = new Uint8Array(await composePage(files[coverKey], { hasText: false }))
pages.push({ id: 'cover', file: 'cover.xhtml', image: 'cover.jpg', paragraphs: [], kind: 'cover' })

// --- title page ---
out['OEBPS/images/title.jpg'] = new Uint8Array(
  await sharp({ create: { width: W, height: H, channels: 3, background: PAPER } })
    .jpeg({ quality: 82 })
    .toBuffer(),
)
pages.push({ id: 'title', file: 'title.xhtml', image: 'title.jpg', paragraphs: [], kind: 'title' })

// --- story ---
for (const [index, page] of source.entries()) {
  const n = String(index + 1).padStart(2, '0')
  out[`OEBPS/images/p${n}.jpg`] = new Uint8Array(
    await composePage(files[`OEBPS/${page.image}`], { hasText: page.paragraphs.length > 0 }),
  )
  pages.push({ id: `p${n}`, file: `p${n}.xhtml`, image: `p${n}.jpg`, paragraphs: page.paragraphs, kind: 'story' })
}

for (const page of pages) {
  let body
  if (page.kind === 'title') {
    body = `<p class="title title-main">The Tale of<br/>Peter Rabbit</p>
<p class="title title-author">by Beatrix Potter</p>
<p class="title title-note">First published 1902. This work is in the public domain.<br/>
A fixed-layout edition prepared for Story Tale Reader.</p>`
  } else {
    const characters = page.paragraphs.join(' ').length
    const { size, leading } = typeScale(characters)
    let top = TEXT_TOP
    body = page.paragraphs
      .map((paragraph) => {
        const block = `<p style="top: ${top}px; font-size: ${size}px; line-height: ${leading}px;">${escapeXml(paragraph)}</p>`
        const lines = Math.ceil((paragraph.length * size * 0.5) / TEXT_WIDTH)
        top += lines * leading + Math.round(leading * 0.45)
        return block
      })
      .join('\n')
  }

  out[`OEBPS/${page.file}`] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head>
<meta name="viewport" content="width=${W}, height=${H}"/>
<meta charset="UTF-8"/>
<title>The Tale of Peter Rabbit</title>
<link href="stylesheet.css" type="text/css" rel="stylesheet"/></head>
<body><div class="page">
<img src="images/${page.image}" alt=""/>
${body}
</div></body></html>`)
}

const manifest = pages
  .map(
    (page, index) =>
      `<item id="${page.id}" href="${page.file}" media-type="application/xhtml+xml"/>\n    ` +
      `<item id="img-${page.id}" href="images/${page.image}" media-type="image/jpeg"` +
      `${index === 0 ? ' properties="cover-image"' : ''}/>`,
  )
  .join('\n    ')

out['OEBPS/package.opf'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid"
         prefix="rendition: http://www.idpf.org/vocab/rendition/#">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>The Tale of Peter Rabbit</dc:title>
    <dc:creator>Beatrix Potter</dc:creator>
    <dc:language>en</dc:language>
    <dc:identifier id="bookid">urn:uuid:story-tale-reader-peter-rabbit-1902</dc:identifier>
    <dc:rights>Public domain. First published 1902.</dc:rights>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
    <meta property="rendition:layout">pre-paginated</meta>
    <meta property="rendition:spread">landscape</meta>
    <meta property="rendition:orientation">auto</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="stylesheet.css" media-type="text/css"/>
    ${manifest}
  </manifest>
  <!-- Deliberately no page-spread properties: this is the shape most real picture
       books ship in, so the sample exercises page-list parity. -->
  <spine>
    ${pages.map((page) => `<itemref idref="${page.id}"/>`).join('\n    ')}
  </spine>
</package>`)

out['OEBPS/nav.xhtml'] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head><body>
<nav epub:type="toc"><ol>
<li><a href="cover.xhtml">Cover</a></li>
<li><a href="title.xhtml">Title Page</a></li>
<li><a href="p01.xhtml">Begin Reading</a></li>
</ol></nav>
<nav epub:type="page-list"><ol>
${pages.map((page, index) => `<li><a href="${page.file}">${index + 1}</a></li>`).join('\n')}
</ol></nav>
</body></html>`)

await mkdir('public/sample', { recursive: true })
const zipped = zipSync(out, { level: 6 })
await writeFile(OUT, zipped)
console.log(`wrote ${OUT} — ${pages.length} pages, ${(zipped.length / 1024 / 1024).toFixed(2)} MB`)
