import { describe, it, expect } from 'vitest'
import { applyDocumentLanguage } from './language'

/**
 * A minimal stand-in for a page document.
 *
 * The real ones live in iframes across a realm boundary, which is why nothing here
 * reaches for `instanceof` — see docs/read-along.md.
 */
function docWith(attrs: Record<string, string> = {}): Document {
  const store = new Map(Object.entries(attrs))
  const root = {
    getAttribute: (name: string) => store.get(name) ?? null,
    setAttribute: (name: string, value: string) => void store.set(name, value),
  }
  return { documentElement: root } as unknown as Document
}

const langOf = (doc: Document) => doc.documentElement.getAttribute('lang')

describe('applyDocumentLanguage', () => {
  it('tags a page that declares nothing', () => {
    const doc = docWith()
    applyDocumentLanguage(doc, 'fr')
    expect(langOf(doc)).toBe('fr')
  })

  it('leaves a page that has already declared itself', () => {
    // Dual-language picture books are common, and the OPF names the language of
    // the publication, which for those is one of the two at best.
    const doc = docWith({ lang: 'cy' })
    applyDocumentLanguage(doc, 'en')
    expect(langOf(doc)).toBe('cy')
  })

  it('treats xml:lang as a declaration', () => {
    // XHTML content documents often carry that one and not the HTML attribute.
    const doc = docWith({ 'xml:lang': 'de' })
    applyDocumentLanguage(doc, 'en')
    expect(langOf(doc)).toBeNull()
  })

  it('overwrites a declaration that is only whitespace', () => {
    const doc = docWith({ lang: '  ' })
    applyDocumentLanguage(doc, 'en')
    expect(langOf(doc)).toBe('en')
  })

  it('does nothing when the book names no language', () => {
    const doc = docWith()
    applyDocumentLanguage(doc, undefined)
    applyDocumentLanguage(doc, '')
    expect(langOf(doc)).toBeNull()
  })

  it('does not throw on a document with no root', () => {
    // Briefly true for an iframe caught between navigations, and an exception
    // here would take down the page it was meant to label.
    const empty = { documentElement: null } as unknown as Document
    expect(() => applyDocumentLanguage(empty, 'en')).not.toThrow()
  })
})
