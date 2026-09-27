import { describe, it, expect } from 'vitest'
import { fixedBoxViewport, inlineStylesheets, parseClassRules, stylesheetHrefs } from './css'
import { parseXml } from '../xml'

const page = (body: string, head = '') =>
  parseXml(`<html xmlns="http://www.w3.org/1999/xhtml"><head>${head}</head>${body}</html>`)

describe('parseClassRules', () => {
  it('reads class rules, later ones winning, and skips at-rules and other selectors', () => {
    const rules = parseClassRules(`
      /* a comment { with braces } */
      @import url(other.css);
      @font-face { font-family: X; src: url(x.ttf) }
      @media screen { .fs { width: 1px } }
      body { width: 9px }
      .fs, .other { width: 2581px; height: 1748px }
      .fs { height: 1800px !important }
      div.fs { width: 5px }
    `)
    expect(Object.fromEntries(rules.get('fs')!)).toEqual({ width: '2581px', height: '1800px' })
    expect(rules.get('other')?.get('width')).toBe('2581px')
    expect(rules.size).toBe(2)
  })
})

describe('fixedBoxViewport', () => {
  const sheet = parseClassRules('.calibre { width: 2581px; height: 1748px } .fs { width: 1200px; height: 1600px } .small { width: 100px; height: 80px }')

  it('takes the size of a body sized in pixels', () => {
    expect(fixedBoxViewport(page('<body class="calibre"><div class="fs"/></body>'), [sheet])).toEqual({ width: 2581, height: 1748 })
  })

  it('takes the size of the first box in the body when the body has none', () => {
    expect(fixedBoxViewport(page('<body>\n  <div class="fs"><p>text</p></div></body>'), [sheet])).toEqual({ width: 1200, height: 1600 })
  })

  it('reads an inline style, which wins over the class', () => {
    expect(fixedBoxViewport(page('<body><div class="fs" style="width: 800px; height: 600px"/></body>'), [sheet])).toEqual({ width: 800, height: 600 })
  })

  it('ignores boxes too small to be a page, sizes not in pixels, and a width with no height', () => {
    expect(fixedBoxViewport(page('<body><div class="small"/></body>'), [sheet])).toBeUndefined()
    expect(fixedBoxViewport(page('<body><div style="width: 100%; height: 100%"/></body>'), [])).toBeUndefined()
    expect(fixedBoxViewport(page('<body style="width: 600px"><p>a reflowable page</p></body>'), [])).toBeUndefined()
  })
})

describe('stylesheet discovery', () => {
  it('lists linked stylesheets and inline style blocks', () => {
    const doc = page(
      '<body/>',
      '<link rel="stylesheet" href="../a.css"/><link rel="icon" href="x.png"/><link rel="alternate stylesheet" href="b.css"/><style>.x { width: 1px }</style>',
    )
    expect(stylesheetHrefs(doc)).toEqual(['../a.css', 'b.css'])
    expect(inlineStylesheets(doc)).toEqual(['.x { width: 1px }'])
  })
})
