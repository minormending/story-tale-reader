import { describe, it, expect } from 'vitest'
import { asElement } from './player'

/**
 * Regression cover for a cross-realm bug that silently disabled tap-to-read.
 *
 * Book pages live in iframes, and every document has its own constructors, so
 * `target instanceof Element` is false for a node from inside one. The check
 * looked correct, compiled clean, and made every word tap register as empty
 * space — so the tap turned the page instead, and turning the page unmounted the
 * document before the click could seek, which made the feature unreachable on
 * exactly the books that have narration.
 */
describe('asElement', () => {
  it('accepts an element from another realm, which instanceof would reject', () => {
    // What an iframe's element looks like from the parent: right shape, wrong
    // constructor — which is precisely what `instanceof Element` rejected and
    // `nodeType` does not care about.
    const foreign = { nodeType: 1, tagName: 'SPAN', closest: () => null } as unknown as EventTarget
    expect(asElement(foreign)).toBe(foreign)
  })

  it('rejects text nodes, documents and null', () => {
    expect(asElement({ nodeType: 3 } as unknown as EventTarget)).toBeNull()
    expect(asElement({ nodeType: 9 } as unknown as EventTarget)).toBeNull()
    expect(asElement(null)).toBeNull()
  })

  it('rejects a non-node event target such as window or an XHR', () => {
    expect(asElement({} as EventTarget)).toBeNull()
  })
})
