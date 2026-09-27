/**
 * Page sizes declared in a stylesheet.
 *
 * A fixed-layout page normally says how big it is with a viewport meta tag or an SVG
 * viewBox. Books converted from Kindle fixed layout — Calibre's output, which is
 * much of what people have — say it in CSS instead: the body, or the one box
 * inside it, is given a width and a height in pixels, and everything on the page is
 * positioned inside that box. Read as a reflowable book, such a page is a 2581px
 * box poured into columns, and its absolutely positioned text lands on itself.
 *
 * This reads just enough CSS to find that box: class rules, and the style attribute.
 */

import { attr, childrenNamed, findFirst, TEXT_NODE, type XmlNode } from '../xml'
import type { Viewport } from '../types'

/** Class name to its declared properties, later rules overriding earlier ones. */
export type ClassRules = Map<string, Map<string, string>>

/** Smaller than this, a sized box is a picture or a panel, not the page. */
const MIN_PAGE_SIDE = 200

/** Parse the class rules of a stylesheet. At-rules (@media, @font-face, @page) are skipped. */
export function parseClassRules(css: string): ClassRules {
  const rules: ClassRules = new Map()
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '')
  let i = 0
  while (i < text.length) {
    const open = text.indexOf('{', i)
    if (open === -1) break
    const selector = text.slice(i, open).trim()

    // Find the block's end, allowing for nested blocks inside at-rules.
    let depth = 1
    let j = open + 1
    while (j < text.length && depth > 0) {
      if (text[j] === '{') depth++
      else if (text[j] === '}') depth--
      j++
    }
    const body = text.slice(open + 1, j - 1)
    i = j

    // A statement at-rule (@import ...;) before this one ends at its semicolon.
    const statement = selector.lastIndexOf(';')
    const cleanSelector = statement === -1 ? selector : selector.slice(statement + 1).trim()
    if (!cleanSelector || cleanSelector.startsWith('@')) continue

    const declarations = parseDeclarations(body)
    for (const part of cleanSelector.split(',')) {
      const match = /^\.([A-Za-z0-9_-]+)$/.exec(part.trim())
      if (!match) continue
      const name = match[1]!
      const existing = rules.get(name) ?? new Map<string, string>()
      for (const [property, value] of declarations) existing.set(property, value)
      rules.set(name, existing)
    }
  }
  return rules
}

export function parseDeclarations(block: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const declaration of block.split(';')) {
    const colon = declaration.indexOf(':')
    if (colon === -1) continue
    const property = declaration.slice(0, colon).trim().toLowerCase()
    const value = declaration.slice(colon + 1).replace(/!important/i, '').trim()
    if (property && value) out.set(property, value)
  }
  return out
}

/** Stylesheets a document links to, as hrefs relative to it. */
export function stylesheetHrefs(doc: XmlNode): string[] {
  const out: string[] = []
  const head = findFirst(doc, 'head')
  if (!head) return out
  for (const link of childrenNamed(head, 'link')) {
    const rel = (attr(link, 'rel') ?? '').toLowerCase().split(/\s+/)
    const href = attr(link, 'href')
    if (href && rel.includes('stylesheet')) out.push(href)
  }
  return out
}

/** The contents of a document's own <style> elements. */
export function inlineStylesheets(doc: XmlNode): string[] {
  const head = findFirst(doc, 'head')
  if (!head) return []
  return childrenNamed(head, 'style').map((style) =>
    style.children.filter((child) => child.local === TEXT_NODE).map((child) => child.text).join(''),
  )
}

function pixels(value: string | undefined): number | undefined {
  if (!value) return undefined
  const match = /^(\d+(?:\.\d+)?)px$/i.exec(value.trim())
  return match ? Number.parseFloat(match[1]!) : undefined
}

function sizeOf(element: XmlNode, sheets: ClassRules[]): Viewport | undefined {
  const declared = new Map<string, string>()
  const classes = (attr(element, 'class') ?? '').split(/\s+/).filter(Boolean)
  for (const sheet of sheets) {
    for (const name of classes) {
      for (const [property, value] of sheet.get(name) ?? []) declared.set(property, value)
    }
  }
  // An inline style wins over any rule.
  for (const [property, value] of parseDeclarations(attr(element, 'style') ?? '')) declared.set(property, value)

  const width = pixels(declared.get('width'))
  const height = pixels(declared.get('height'))
  if (width === undefined || height === undefined) return undefined
  if (width < MIN_PAGE_SIDE || height < MIN_PAGE_SIDE) return undefined
  return { width, height }
}

/**
 * The page size a document's CSS gives it, if it is a fixed-size box: the body
 * itself, or else the first element inside it, sized in pixels on both sides.
 */
export function fixedBoxViewport(doc: XmlNode, sheets: ClassRules[]): Viewport | undefined {
  const body = findFirst(doc, 'body')
  if (!body) return undefined
  const first = body.children.find((child) => child.local !== TEXT_NODE)
  return sizeOf(body, sheets) ?? (first ? sizeOf(first, sheets) : undefined)
}
