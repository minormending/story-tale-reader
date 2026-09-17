import { describe, it, expect } from 'vitest'
import { parseXml, findAll, findFirst, childrenNamed, attr, textContent, decodeEntities } from './xml'

describe('decodeEntities', () => {
  it('decodes named, decimal and hex references', () => {
    expect(decodeEntities('&amp;&lt;&gt;&quot;&apos;')).toBe('&<>"\'')
    expect(decodeEntities('&#8220;Oh,&#8221;')).toBe('“Oh,”')
    expect(decodeEntities('&#x201C;hi&#x201D;')).toBe('“hi”')
  })
  it('leaves unknown entities verbatim rather than dropping text', () => {
    expect(decodeEntities('a &bogus; b')).toBe('a &bogus; b')
  })
})

describe('parseXml', () => {
  it('parses elements, attributes and nesting', () => {
    const doc = parseXml(`<?xml version="1.0"?><root a="1"><kid b="2"/><kid b="3">hi</kid></root>`)
    const root = doc.children[0]!
    expect(root.name).toBe('root')
    expect(root.attrs.a).toBe('1')
    const kids = childrenNamed(root, 'kid')
    expect(kids.map((k) => k.attrs.b)).toEqual(['2', '3'])
    expect(kids[1]!.text).toBe('hi')
  })

  it('strips a BOM, declaration, comments and DOCTYPE with an internal subset', () => {
    const doc = parseXml(
      '﻿<?xml version="1.0"?><!DOCTYPE x [<!ENTITY foo "bar">]><!-- c --><x>ok</x>',
    )
    expect(doc.children.length).toBe(1)
    expect(doc.children[0]!.local).toBe('x')
    expect(doc.children[0]!.text).toBe('ok')
  })

  it('keeps mixed content in document order', () => {
    const doc = parseXml('<p>Hello <b>world</b>!</p>')
    expect(textContent(doc.children[0]!)).toBe('Hello world!')
  })

  it('handles CDATA', () => {
    const doc = parseXml('<a><![CDATA[<not markup> & raw]]></a>')
    expect(textContent(doc.children[0]!)).toBe('<not markup> & raw')
  })

  it('resolves namespaces and matches attributes across prefixes', () => {
    const doc = parseXml(
      `<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/">
         <metadata><dc:title>T</dc:title></metadata>
         <item xlink:href="a.jpg" xmlns:xlink="http://www.w3.org/1999/xlink"/>
       </package>`,
    )
    const pkg = doc.children[0]!
    expect(pkg.ns).toBe('http://www.idpf.org/2007/opf')
    const title = findFirst(pkg, 'title')!
    expect(title.ns).toBe('http://purl.org/dc/elements/1.1/')
    expect(title.text).toBe('T')
    // namespace-tolerant attribute lookup
    expect(attr(findFirst(pkg, 'item')!, 'href')).toBe('a.jpg')
  })

  it('finds descendants in document order', () => {
    const doc = parseXml('<a><b id="1"/><c><b id="2"/></c><b id="3"/></a>')
    expect(findAll(doc, 'b').map((n) => n.attrs.id)).toEqual(['1', '2', '3'])
  })

  it('tolerates unbalanced closing tags without unwinding the document', () => {
    const doc = parseXml('<a><b>x</c></b><d/></a>')
    const a = doc.children[0]!
    expect(a.local).toBe('a')
    expect(childrenNamed(a, 'd').length).toBe(1)
  })

  it('handles self-closing tags with attributes and no space before the slash', () => {
    const doc = parseXml('<a><img src="x.jpg"/><br/></a>')
    const a = doc.children[0]!
    expect(childrenNamed(a, 'img')[0]!.attrs.src).toBe('x.jpg')
    expect(childrenNamed(a, 'br').length).toBe(1)
  })
})
