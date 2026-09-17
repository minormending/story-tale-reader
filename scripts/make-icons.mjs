/**
 * Rasterise public/icon.svg into the PNGs the PWA manifest and the Android
 * launcher need. Run with `npm run icons` after changing the SVG.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import sharp from 'sharp'

const svg = readFileSync('public/icon.svg')

async function png(size, out, background) {
  let pipeline = sharp(svg, { density: 384 }).resize(size, size, { fit: 'contain' })
  if (background) pipeline = pipeline.flatten({ background })
  await writeFile(out, await pipeline.png().toBuffer())
  console.log(`wrote ${out} (${size}x${size})`)
}

await mkdir('assets', { recursive: true })

// PWA manifest icons.
await png(192, 'public/icon-192.png')
await png(512, 'public/icon-512.png')

// Sources for @capacitor/assets, which generates every Android density from these.
await png(1024, 'assets/icon.png')
// The foreground of an adaptive icon is cropped to a circle, so the artwork needs
// padding; rendering the same square art at 60% inside a transparent 1024 canvas
// keeps the book clear of the mask.
await sharp({
  create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
})
  .composite([{ input: await sharp(svg, { density: 384 }).resize(620, 620).png().toBuffer(), gravity: 'centre' }])
  .png()
  .toFile('assets/icon-foreground.png')
console.log('wrote assets/icon-foreground.png (1024x1024)')

await sharp({
  create: { width: 1024, height: 1024, channels: 4, background: { r: 21, g: 20, b: 26, alpha: 1 } },
})
  .png()
  .toFile('assets/icon-background.png')
console.log('wrote assets/icon-background.png (1024x1024)')
