/**
 * Navigation: the EPUB 3 nav document and the EPUB 2 NCX.
 *
 * The `page-list` matters far more here than in a normal reader: it is how we
 * recover spread parity for books whose spine carries no page-spread properties
 * (SPEC.md §5.3), which is the cause of the off-by-one spread bug.
 */

import { parseXml, findAll, findFirst, childrenNamed, attr, textContent, type XmlNode } from '../xml'
import { dirname, resolvePath, splitFragment } from '../path'
import type { NavItem } from '../types'

export interface NavDocument {
  toc: NavItem[]
  landmarks: NavItem[]
  /** Container-absolute content path -> printed page label, e.g. "OEBPS/page012.xhtml" -> "12". */
  pageList: Map<string, string>
}

const EMPTY: NavDocument = { toc: [], landmarks: [], pageList: new Map() }

function makeNavItem(label: string, href: string, baseDir: string, children: NavItem[]): NavItem {
  const [, fragment] = splitFragment(href)
  return { label, href, path: resolvePath(baseDir, href), fragment, children }
}

/* --------------------------- EPUB 3 nav document --------------------------- */

function parseOrderedList(list: XmlNode | undefined, baseDir: string): NavItem[] {
  if (!list) return []
  const out: NavItem[] = []
  for (const li of childrenNamed(list, 'li')) {
    const anchor = childrenNamed(li, 'a')[0] ?? childrenNamed(li, 'span')[0]
    const nested = parseOrderedList(childrenNamed(li, 'ol')[0], baseDir)
    const href = anchor ? attr(anchor, 'href') : undefined
    const label = anchor ? textContent(anchor).trim() : ''
    if (href) out.push(makeNavItem(label, href, baseDir, nested))
    else if (nested.length) out.push({ label, href: '', path: '', fragment: '', children: nested })
  }
  return out
}

export function parseNavDocument(xml: string, navPath: string): NavDocument {
  const baseDir = dirname(navPath)
  const doc = parseXml(xml)
  const navs = findAll(doc, 'nav')

  const byType = (type: string): XmlNode | undefined =>
    navs.find((nav) => (attr(nav, 'type') ?? '').split(/\s+/).includes(type))

  const tocNav = byType('toc') ?? navs[0]
  const toc = parseOrderedList(tocNav ? findFirst(tocNav, 'ol') : undefined, baseDir)
  const landmarks = parseOrderedList(
    byType('landmarks') ? findFirst(byType('landmarks')!, 'ol') : undefined,
    baseDir,
  )

  const pageList = new Map<string, string>()
  const pageNav = byType('page-list')
  if (pageNav) {
    for (const anchor of findAll(pageNav, 'a')) {
      const href = attr(anchor, 'href')
      const label = textContent(anchor).trim()
      if (!href || !label) continue
      const path = resolvePath(baseDir, href)
      // First label wins: a page that starts mid-document is still that page.
      if (!pageList.has(path)) pageList.set(path, label)
    }
  }

  return { toc, landmarks, pageList }
}

/* ------------------------------- EPUB 2 NCX ------------------------------- */

function parseNavPoints(parent: XmlNode, baseDir: string): NavItem[] {
  const out: NavItem[] = []
  for (const point of childrenNamed(parent, 'navPoint')) {
    const label = textContent(findFirst(point, 'navLabel') ?? point).trim()
    const href = attr(childrenNamed(point, 'content')[0] ?? point, 'src') ?? ''
    if (href) out.push(makeNavItem(label, href, baseDir, parseNavPoints(point, baseDir)))
  }
  return out
}

export function parseNcx(xml: string, ncxPath: string): NavDocument {
  const baseDir = dirname(ncxPath)
  const doc = parseXml(xml)

  const navMap = findFirst(doc, 'navMap')
  const toc = navMap ? parseNavPoints(navMap, baseDir) : []

  const pageList = new Map<string, string>()
  const pageListEl = findFirst(doc, 'pageList')
  if (pageListEl) {
    for (const target of findAll(pageListEl, 'pageTarget')) {
      const label = textContent(findFirst(target, 'navLabel') ?? target).trim()
      const href = attr(childrenNamed(target, 'content')[0] ?? target, 'src')
      if (!href || !label) continue
      const path = resolvePath(baseDir, href)
      if (!pageList.has(path)) pageList.set(path, label)
    }
  }

  return { toc, landmarks: [], pageList }
}

export const emptyNav = (): NavDocument => ({ ...EMPTY, pageList: new Map() })
