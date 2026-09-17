/**
 * Fallback page loading for browsers where the service worker is unavailable
 * (SPEC.md §9.3) — a private window that blocks registration, a locked-down
 * enterprise browser, or an automated one.
 *
 * Each page is rewritten so its assets become blob URLs and its stylesheets are
 * inlined, then handed to the iframe through `srcdoc`. `srcdoc` matters: a document
 * loaded from a `blob:` URL gets an opaque origin and could not be scripted, which
 * would take read-along with it, whereas a `srcdoc` iframe inherits this origin. So
 * the fallback keeps word highlighting working, which the original plan did not.
 *
 * This is the slower path — every referenced asset is decompressed up front rather
 * than on request — so it is only used when the service worker really is missing.
 */

import { ZipArchive } from '../engine/zip/reader'
import { dirname, mimeTypeFor, resolvePath } from '../engine/path'

/** Attribute URLs worth rewriting. Anchors and external links are left alone. */
const ASSET_ATTRIBUTES = /\s(src|href|xlink:href|poster|data)\s*=\s*("([^"]*)"|'([^']*)')/gi
const STYLESHEET_LINK = /<link\b[^>]*>/gi
const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"]+))\s*\)/gi

function isExternal(url: string): boolean {
  return (
    url.startsWith('#') ||
    url.startsWith('data:') ||
    url.startsWith('blob:') ||
    url.startsWith('mailto:') ||
    /^[a-z][a-z0-9+.-]*:/i.test(url)
  )
}

export class InlinePageResolver {
  private readonly blobs = new Map<string, Promise<string>>()

  constructor(private readonly archive: ZipArchive) {}

  /** A complete HTML document for a page, ready for an iframe's `srcdoc`. */
  async page(path: string): Promise<string> {
    const html = await this.archive.readText(path)
    const baseDir = dirname(path)

    const withStyles = await this.inlineStylesheets(html, baseDir)
    return await this.rewriteAttributes(withStyles, baseDir)
  }

  /** Release every blob URL this resolver minted. */
  dispose(): void {
    for (const url of this.blobs.values()) {
      void url.then(URL.revokeObjectURL).catch(() => {})
    }
    this.blobs.clear()
  }

  private blobUrl(path: string): Promise<string> {
    let url = this.blobs.get(path)
    if (!url) {
      url = this.archive
        .read(path)
        .then((bytes) =>
          URL.createObjectURL(
            new Blob([bytes.slice().buffer as ArrayBuffer], { type: mimeTypeFor(path) }),
          ),
        )
      this.blobs.set(path, url)
    }
    return url
  }

  private async inlineStylesheets(html: string, baseDir: string): Promise<string> {
    const links = [...html.matchAll(STYLESHEET_LINK)]
    let out = html

    for (const link of links) {
      const tag = link[0]
      if (!/rel\s*=\s*["']?stylesheet/i.test(tag)) continue
      const href = /href\s*=\s*("([^"]*)"|'([^']*)')/i.exec(tag)
      const url = href?.[2] ?? href?.[3]
      if (!url || isExternal(url)) continue

      const cssPath = resolvePath(baseDir, url)
      if (!this.archive.has(cssPath)) continue

      try {
        const css = await this.rewriteCss(await this.archive.readText(cssPath), dirname(cssPath))
        out = out.replace(tag, `<style>\n${css}\n</style>`)
      } catch {
        // Leave the link alone; a missing stylesheet is better than a broken page.
      }
    }

    return out
  }

  /** Point every `url()` in a stylesheet — including @font-face — at a blob. */
  private async rewriteCss(css: string, baseDir: string): Promise<string> {
    const replacements = new Map<string, string>()

    for (const match of css.matchAll(CSS_URL)) {
      const raw = match[1] ?? match[2] ?? match[3] ?? ''
      if (!raw || isExternal(raw)) continue
      const assetPath = resolvePath(baseDir, raw)
      if (!this.archive.has(assetPath) || replacements.has(match[0])) continue
      replacements.set(match[0], `url("${await this.blobUrl(assetPath)}")`)
    }

    let out = css
    for (const [from, to] of replacements) out = out.split(from).join(to)
    return out
  }

  private async rewriteAttributes(html: string, baseDir: string): Promise<string> {
    const replacements = new Map<string, string>()

    for (const match of html.matchAll(ASSET_ATTRIBUTES)) {
      const whole = match[0]
      const attribute = match[1]!
      const value = match[3] ?? match[4] ?? ''
      if (!value || isExternal(value) || replacements.has(whole)) continue

      const assetPath = resolvePath(baseDir, value)
      if (!this.archive.has(assetPath)) continue
      // Content documents stay as they are: only this page is being inlined.
      if (/\.x?html?$/i.test(assetPath)) continue

      replacements.set(whole, ` ${attribute}="${await this.blobUrl(assetPath)}"`)
    }

    let out = html
    for (const [from, to] of replacements) out = out.split(from).join(to)
    return out
  }
}
