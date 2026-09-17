/**
 * A small, dependency-free XML parser.
 *
 * Why not DOMParser or @xmldom/xmldom? The engine has to behave *identically* in
 * the browser and in a headless unit test, and EPUB parsing bugs are exactly the
 * class of bug this project exists to avoid. A parser we own is ~200 lines, has no
 * environment divergence, and can be tested directly in Node.
 *
 * EPUB container/package/nav/SMIL documents are well-formed XML by specification,
 * so this parser is deliberately strict about structure and lenient about entities.
 * Malformed *HTML* (from MOBI, §8.2) is parsed with the browser's DOMParser instead.
 */

export interface XmlNode {
  /** Qualified name as written, e.g. `dc:title`. `#document` for the root. */
  name: string
  /** Local name with any prefix stripped, e.g. `title`. Lowercased for comparison. */
  local: string
  prefix: string
  /** Resolved namespace URI, or '' when the element is in no namespace. */
  ns: string
  /** Attributes keyed by qualified name, exactly as written. */
  attrs: Record<string, string>
  children: XmlNode[]
  /** For `#text` nodes, the character data. For elements, their direct text. */
  text: string
}

/** Text nodes appear in `children` as `#text` so mixed content keeps document order. */
export const TEXT_NODE = '#text'

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  nbsp: ' ', copy: '©', reg: '®', trade: '™',
  mdash: '—', ndash: '–', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  laquo: '«', raquo: '»', deg: '°', middot: '·',
  eacute: 'é', egrave: 'è', agrave: 'à', ccedil: 'ç',
}

export function decodeEntities(input: string): string {
  if (input.indexOf('&') === -1) return input
  return input.replace(/&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body: string) => {
    if (body.charCodeAt(0) === 35 /* # */) {
      const hex = body.charCodeAt(1) === 120 || body.charCodeAt(1) === 88
      const code = hex ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match
      try { return String.fromCodePoint(code) } catch { return match }
    }
    // Unknown named entities are left verbatim rather than dropped — losing text
    // silently is worse than showing an entity reference.
    return NAMED_ENTITIES[body] ?? match
  })
}

function makeNode(name: string): XmlNode {
  const colon = name.indexOf(':')
  const prefix = colon === -1 ? '' : name.slice(0, colon)
  const local = colon === -1 ? name : name.slice(colon + 1)
  return { name, local: local.toLowerCase(), prefix, ns: '', attrs: {}, children: [], text: '' }
}

const NAME_END = /[\s/>=]/

export function parseXml(source: string): XmlNode {
  let src = source
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1)

  const root = makeNode('#document')
  const stack: XmlNode[] = [root]
  // Namespace scopes run parallel to the element stack: prefix -> URI, '' = default.
  const scopes: Record<string, string>[] = [{ xml: 'http://www.w3.org/XML/1998/namespace' }]

  let i = 0
  const len = src.length

  const top = (): XmlNode => stack[stack.length - 1]!
  const scope = (): Record<string, string> => scopes[scopes.length - 1]!

  while (i < len) {
    const lt = src.indexOf('<', i)
    if (lt === -1) {
      appendText(top(), src.slice(i))
      break
    }
    if (lt > i) appendText(top(), src.slice(i, lt))

    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4)
      i = end === -1 ? len : end + 3
      continue
    }
    if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt + 9)
      const body = src.slice(lt + 9, end === -1 ? len : end)
      if (body) {
        const cdata = makeNode(TEXT_NODE)
        cdata.text = body
        top().children.push(cdata)
        top().text += body
      }
      i = end === -1 ? len : end + 3
      continue
    }
    if (src.startsWith('<?', lt)) {
      const end = src.indexOf('?>', lt + 2)
      i = end === -1 ? len : end + 2
      continue
    }
    if (src.startsWith('<!', lt)) {
      // DOCTYPE, possibly with an internal subset in [ ... ] that may contain '>'.
      let j = lt + 2
      let depth = 0
      while (j < len) {
        const ch = src.charCodeAt(j)
        if (ch === 91 /* [ */) depth++
        else if (ch === 93 /* ] */) depth--
        else if (ch === 62 /* > */ && depth <= 0) break
        j++
      }
      i = j + 1
      continue
    }

    if (src.charCodeAt(lt + 1) === 47 /* / */) {
      const end = src.indexOf('>', lt)
      const closing = src.slice(lt + 2, end === -1 ? len : end).trim()
      // Pop to the matching open element. Unbalanced markup pops one level rather
      // than unwinding the whole document.
      for (let d = stack.length - 1; d > 0; d--) {
        if (stack[d]!.name === closing) {
          stack.length = d
          scopes.length = d
          break
        }
      }
      if (stack.length === 0) { stack.push(root); scopes.push({}) }
      i = end === -1 ? len : end + 1
      continue
    }

    // Opening tag
    let j = lt + 1
    while (j < len && !NAME_END.test(src[j]!)) j++
    const node = makeNode(src.slice(lt + 1, j))
    const inherited = scope()
    let declared: Record<string, string> | null = null

    // Attributes
    for (;;) {
      while (j < len && /\s/.test(src[j]!)) j++
      const ch = src.charCodeAt(j)
      if (j >= len || ch === 62 /* > */ || (ch === 47 /* / */ && src.charCodeAt(j + 1) === 62)) break

      let k = j
      while (k < len && !NAME_END.test(src[k]!)) k++
      const attrName = src.slice(j, k)
      if (!attrName) { j++; continue }

      while (k < len && /\s/.test(src[k]!)) k++
      let value = ''
      if (src.charCodeAt(k) === 61 /* = */) {
        k++
        while (k < len && /\s/.test(src[k]!)) k++
        const quote = src.charCodeAt(k)
        if (quote === 34 || quote === 39) {
          const close = src.indexOf(String.fromCharCode(quote), k + 1)
          value = src.slice(k + 1, close === -1 ? len : close)
          k = close === -1 ? len : close + 1
        } else {
          const start = k
          while (k < len && !/[\s>]/.test(src[k]!)) k++
          value = src.slice(start, k)
        }
      }
      node.attrs[attrName] = decodeEntities(value)

      if (attrName === 'xmlns') {
        declared ??= { ...inherited }
        declared[''] = node.attrs[attrName]!
      } else if (attrName.startsWith('xmlns:')) {
        declared ??= { ...inherited }
        declared[attrName.slice(6)] = node.attrs[attrName]!
      }
      j = k
    }

    const active = declared ?? inherited
    node.ns = node.prefix ? (active[node.prefix] ?? '') : (active[''] ?? '')

    top().children.push(node)

    const selfClosing = src.charCodeAt(j) === 47 /* / */
    const gt = src.indexOf('>', j)
    i = gt === -1 ? len : gt + 1

    if (!selfClosing) {
      stack.push(node)
      scopes.push(active)
    }
  }

  return root
}

function appendText(node: XmlNode, raw: string): void {
  if (!raw) return
  const decoded = decodeEntities(raw)
  const text = makeNode(TEXT_NODE)
  text.text = decoded
  node.children.push(text)
  node.text += decoded
}

/* ------------------------------ queries ------------------------------ */

/** Direct children with the given local name (case-insensitive). */
export function childrenNamed(node: XmlNode, local: string): XmlNode[] {
  const want = local.toLowerCase()
  return node.children.filter((c) => c.local === want)
}

/** All descendants with the given local name, in document order. */
export function findAll(node: XmlNode, local: string): XmlNode[] {
  const want = local.toLowerCase()
  const out: XmlNode[] = []
  const walk = (n: XmlNode): void => {
    for (const child of n.children) {
      if (child.local === want) out.push(child)
      walk(child)
    }
  }
  walk(node)
  return out
}

export function findFirst(node: XmlNode, local: string): XmlNode | undefined {
  const want = local.toLowerCase()
  for (const child of node.children) {
    if (child.local === want) return child
    const nested = findFirst(child, want)
    if (nested) return nested
  }
  return undefined
}

/**
 * Attribute lookup that tolerates namespace prefixes: `attr(el, 'href')` matches
 * `href`, `xlink:href` and `epub:href`. Exact qualified matches win.
 */
export function attr(node: XmlNode, name: string): string | undefined {
  const direct = node.attrs[name]
  if (direct !== undefined) return direct
  const want = name.toLowerCase()
  for (const key of Object.keys(node.attrs)) {
    const colon = key.indexOf(':')
    const local = colon === -1 ? key : key.slice(colon + 1)
    if (local.toLowerCase() === want) return node.attrs[key]
  }
  return undefined
}

/**
 * Recursive text content in document order. Walks `children` rather than summing
 * `node.text`, so mixed content like `<p>Hello <b>world</b>!</p>` yields
 * "Hello world!" and not "Hello !world".
 */
export function textContent(node: XmlNode): string {
  if (node.local === TEXT_NODE) return node.text
  let out = ''
  for (const child of node.children) out += textContent(child)
  return out
}
