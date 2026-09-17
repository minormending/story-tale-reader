/**
 * Write a small, valid multi-page PDF fixture by hand.
 *
 * Hand-assembled rather than pulled from a library because the only thing it has to
 * exercise is the reader's own page/spread handling, and a dependency-free generator
 * keeps the fixture reproducible.
 */
import { writeFile } from 'node:fs/promises'

const PAGES = 6
const WIDTH = 420
const HEIGHT = 600

function contentStream(n) {
  const half = n % 2 === 0 ? 'left' : 'right'
  return `1 0 0 RG 0.95 0.9 0.8 rg
0 0 ${WIDTH} ${HEIGHT} re f
0.2 0.2 0.25 rg
BT /F1 48 Tf 40 ${HEIGHT - 120} Td (Page ${n}) Tj ET
BT /F1 18 Tf 40 ${HEIGHT - 170} Td (${half} hand page) Tj ET
0.85 0.55 0.25 rg
40 60 ${WIDTH - 80} 220 re f`
}

const objects = []
const kids = []
for (let i = 0; i < PAGES; i++) {
  kids.push(`${3 + i * 2} 0 R`)
}

objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`
objects[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${PAGES} >>`

for (let i = 0; i < PAGES; i++) {
  const pageId = 3 + i * 2
  const contentId = pageId + 1
  const stream = contentStream(i + 1)
  objects[pageId] =
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${WIDTH} ${HEIGHT}] ` +
    `/Resources << /Font << /F1 ${3 + PAGES * 2} 0 R >> >> /Contents ${contentId} 0 R >>`
  objects[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
}
objects[3 + PAGES * 2] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`

let pdf = '%PDF-1.4\n'
const offsets = []
for (let id = 1; id < objects.length; id++) {
  if (!objects[id]) continue
  offsets[id] = pdf.length
  pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`
}

const xrefOffset = pdf.length
const maxId = objects.length
pdf += `xref\n0 ${maxId}\n0000000000 65535 f \n`
for (let id = 1; id < maxId; id++) {
  pdf += offsets[id] !== undefined
    ? `${String(offsets[id]).padStart(10, '0')} 00000 n \n`
    : `0000000000 65535 f \n`
}
pdf += `trailer\n<< /Size ${maxId} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`

await writeFile('corpus/fixtures/sample-pages.pdf', pdf, 'latin1')
console.log('wrote corpus/fixtures/sample-pages.pdf')
