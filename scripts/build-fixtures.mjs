/**
 * Generate synthetic test EPUBs into corpus/fixtures.
 *
 * These encode the *structures* that break real readers — books with no spread
 * metadata, explicit page-spread properties, right-to-left progression, a
 * pre-composed double-width page, and plain reflowable text — without shipping
 * anyone's copyrighted artwork. The fixed-layout fixtures draw a circle straddling
 * the gutter, so a mispaired spread is obvious at a glance.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { zipSync, strToU8 } from 'fflate'
import sharp from 'sharp'

const OUT = 'corpus/fixtures'
const W = 800
const H = 1200

const PALETTE = ['#f2b880', '#9ad1d4', '#c5e99b', '#f6a5c0', '#b8b3e9', '#ffd6a5']

/** One half of a spread: a big numeral plus half of a circle that crosses the gutter. */
async function pageImage(pageNumber, side, colour) {
  const circleCx = side === 'left' ? W : 0
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="${colour}"/>
    <circle cx="${circleCx}" cy="${H / 2}" r="300" fill="#ffffff" opacity="0.85"/>
    <text x="${W / 2}" y="${H - 120}" font-family="Helvetica,Arial,sans-serif" font-size="160"
          font-weight="bold" fill="#2b2b33" text-anchor="middle">${pageNumber}</text>
    <text x="${W / 2}" y="140" font-family="Helvetica,Arial,sans-serif" font-size="48"
          fill="#2b2b33" text-anchor="middle">${side} page</text>
  </svg>`
  return sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer()
}

async function spreadImage(pageNumber, colour) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W * 2}" height="${H}">
    <rect width="${W * 2}" height="${H}" fill="${colour}"/>
    <circle cx="${W}" cy="${H / 2}" r="300" fill="#ffffff" opacity="0.85"/>
    <text x="${W}" y="${H - 120}" font-family="Helvetica,Arial,sans-serif" font-size="160"
          font-weight="bold" fill="#2b2b33" text-anchor="middle">${pageNumber}</text>
    <text x="${W}" y="140" font-family="Helvetica,Arial,sans-serif" font-size="48"
          fill="#2b2b33" text-anchor="middle">pre-composed spread</text>
  </svg>`
  return sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer()
}

const CONTAINER = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`

const CSS = `body { width: ${W}px; height: ${H}px; margin: 0; }
body > div { position: relative; overflow: hidden; width: ${W}px; height: ${H}px; }
img { position: absolute; top: 0; left: 0; height: ${H}px; }
p { position: absolute; font-family: serif; font-size: 40px; line-height: 56px;
    color: #2b2b33; margin: 0; width: ${W - 120}px; }`

function fxlPage(n, wide) {
  const width = wide ? W * 2 : W
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head>
<meta name="viewport" content="width=${width}, height=${H}"/>
<meta charset="UTF-8"/><title>Page ${n}</title>
<link href="stylesheet.css" type="text/css" rel="stylesheet"/></head>
<body><div class="page">
<img src="images/p${n}.jpg" alt=""/>
<p style="left: 60px; top: 260px;">This text is positioned on the illustration at
left:60px, top:260px. If you can read it over the picture, the layout is correct.</p>
</div></body></html>`
}

async function buildFixedLayout({ name, spreadHints, direction = 'ltr', pageList = true, wideAt = -1 }) {
  const count = 9
  const files = {
    'mimetype': strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(CONTAINER),
    'OEBPS/stylesheet.css': strToU8(CSS),
  }

  for (let n = 1; n <= count; n++) {
    const wide = n === wideAt
    const colour = PALETTE[n % PALETTE.length]
    files[`OEBPS/images/p${n}.jpg`] = new Uint8Array(
      wide ? await spreadImage(n, colour) : await pageImage(n, n % 2 === 0 ? 'left' : 'right', colour),
    )
    files[`OEBPS/p${n}.xhtml`] = strToU8(fxlPage(n, wide))
  }

  const manifest = Array.from({ length: count }, (_, i) =>
    `<item id="p${i + 1}" href="p${i + 1}.xhtml" media-type="application/xhtml+xml"/>` +
    `<item id="img${i + 1}" href="images/p${i + 1}.jpg" media-type="image/jpeg"${i === 0 ? ' properties="cover-image"' : ''}/>`,
  ).join('\n    ')

  const spine = Array.from({ length: count }, (_, i) => {
    if (!spreadHints) return `<itemref idref="p${i + 1}"/>`
    if (i === 0) return `<itemref idref="p1" properties="rendition:page-spread-center"/>`
    const side = i % 2 === 1 ? 'left' : 'right'
    return `<itemref idref="p${i + 1}" properties="page-spread-${side}"/>`
  }).join('\n    ')

  files['OEBPS/package.opf'] = strToU8(`<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid"
         prefix="rendition: http://www.idpf.org/vocab/rendition/#">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${name}</dc:title>
    <dc:creator>Story Tale Reader fixtures</dc:creator>
    <dc:identifier id="bookid">urn:uuid:${name}</dc:identifier>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
    <meta property="rendition:layout">pre-paginated</meta>
    <meta property="rendition:spread">landscape</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="stylesheet.css" media-type="text/css"/>
    ${manifest}
  </manifest>
  <spine page-progression-direction="${direction}">
    ${spine}
  </spine>
</package>`)

  const pages = pageList
    ? `<nav epub:type="page-list"><ol>${Array.from({ length: count }, (_, i) =>
        `<li><a href="p${i + 1}.xhtml">${i + 1}</a></li>`).join('')}</ol></nav>`
    : ''

  files['OEBPS/nav.xhtml'] = strToU8(`<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${name}</title></head><body>
<nav epub:type="toc"><ol><li><a href="p1.xhtml">Start</a></li></ol></nav>
${pages}
</body></html>`)

  await writeFile(`${OUT}/${name}.epub`, zipSync(files))
  console.log(`wrote ${OUT}/${name}.epub`)
}

const LOREM = [
  'The robin built her nest on the top of the slide, which was, everyone agreed, a most inconvenient place for a nest.',
  'Amelia Bedelia looked at the nest for a long time. Then she looked at the slide. Then she looked at the nest again.',
  'A slide is for sliding, she thought. But a nest is for sitting. And you cannot do both at once, not properly.',
  'So she fetched a ladder, and a notebook, and a very small umbrella, because it looked like rain and birds do not carry umbrellas.',
]

async function buildReflowable() {
  const name = 'reflowable-chapters'
  const chapters = 4
  const files = {
    'mimetype': strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(CONTAINER),
    'OEBPS/stylesheet.css': strToU8('body { font-family: serif; } h1 { font-size: 1.6em; }'),
  }

  for (let c = 1; c <= chapters; c++) {
    const paragraphs = Array.from({ length: 14 }, (_, i) => `<p>${LOREM[(c + i) % LOREM.length]}</p>`).join('\n')
    files[`OEBPS/ch${c}.xhtml`] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="UTF-8"/>
<title>Chapter ${c}</title><link href="stylesheet.css" rel="stylesheet" type="text/css"/></head>
<body><h1>Chapter ${c}</h1>
${paragraphs}
</body></html>`)
  }

  files['OEBPS/package.opf'] = strToU8(`<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Reflowable Chapters</dc:title>
    <dc:creator>Story Tale Reader fixtures</dc:creator>
    <dc:identifier id="bookid">urn:uuid:reflowable-chapters</dc:identifier>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
    <meta property="rendition:layout">reflowable</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="stylesheet.css" media-type="text/css"/>
    ${Array.from({ length: chapters }, (_, i) =>
      `<item id="ch${i + 1}" href="ch${i + 1}.xhtml" media-type="application/xhtml+xml"/>`).join('\n    ')}
  </manifest>
  <spine>
    ${Array.from({ length: chapters }, (_, i) => `<itemref idref="ch${i + 1}"/>`).join('\n    ')}
  </spine>
</package>`)

  files['OEBPS/nav.xhtml'] = strToU8(`<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head><body>
<nav epub:type="toc"><ol>${Array.from({ length: chapters }, (_, i) =>
  `<li><a href="ch${i + 1}.xhtml">Chapter ${i + 1}</a></li>`).join('')}</ol></nav>
</body></html>`)

  await writeFile(`${OUT}/${name}.epub`, zipSync(files))
  console.log(`wrote ${OUT}/${name}.epub`)
}

await mkdir(OUT, { recursive: true })
await buildFixedLayout({ name: 'fxl-no-spread-hints' })
await buildFixedLayout({ name: 'fxl-explicit-spreads', spreadHints: true })
await buildFixedLayout({ name: 'fxl-no-page-list', pageList: false })
await buildFixedLayout({ name: 'fxl-rtl', direction: 'rtl' })
await buildFixedLayout({ name: 'fxl-mixed-spread-page', wideAt: 5 })
await buildReflowable()
