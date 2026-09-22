import { describe, it, expect } from 'vitest'
import { describePictures, describeReadingSupport, type AltTextEvidence } from './readingSupport'

const evidence = (over: Partial<AltTextEvidence> = {}): AltTextEvidence => ({
  images: 0,
  described: 0,
  decorative: 0,
  pagesChecked: 12,
  pageCount: 12,
  ...over,
})

const texts = (notes: { text: string }[]) => notes.map((n) => n.text)

describe('describePictures', () => {
  it('says plainly when nothing is described', () => {
    const note = describePictures(evidence({ images: 12, described: 0 }), false)
    expect(note).toEqual({ tone: 'no', text: 'The pictures are not described.' })
  })

  it('says so when everything is', () => {
    const note = describePictures(evidence({ images: 12, described: 12 }), false)
    expect(note?.tone).toBe('yes')
    expect(note?.text).toBe('Every picture is described.')
  })

  it('counts the shortfall when only some are', () => {
    const note = describePictures(evidence({ images: 10, described: 4 }), false)
    expect(note?.text).toBe('4 of 10 pictures are described.')
  })

  it('does not hold decorative images against the book', () => {
    // Two real pictures, both described, plus eight rules and flourishes marked
    // decorative. That is a fully described book.
    const note = describePictures(evidence({ images: 10, described: 2, decorative: 8 }), false)
    expect(note?.tone).toBe('yes')
  })

  it('says how far it looked when it did not look at everything', () => {
    const note = describePictures(evidence({ images: 8, described: 0, pagesChecked: 12, pageCount: 40 }), false)
    expect(note?.text).toBe('The pictures are not described in the first 12 pages.')
  })

  it('claims nothing about a book it did not examine', () => {
    expect(describePictures(evidence({ pagesChecked: 0, images: 0 }), false)).toBeUndefined()
  })

  it('stays quiet about a book with no pictures', () => {
    // A book of pure text passed no check; saying it did would be noise.
    expect(describePictures(evidence({ images: 0 }), false)).toBeUndefined()
    expect(describePictures(evidence({ images: 4, decorative: 4 }), false)).toBeUndefined()
  })

  it('reports a picture book whose illustrations are all marked decoration', () => {
    // alt="" on the one image of a fixed-layout page says "nothing here worth
    // reading out" about the illustration that *is* the page. Ordinary in a
    // reflowable book, and the thing a parent most needs told in this one.
    const note = describePictures(evidence({ images: 7, decorative: 7 }), true)
    expect(note).toEqual({
      tone: 'no',
      text: 'The pictures are marked as decoration, so they are not described.',
    })
  })

  it('still says nothing about a fixed-layout book with no images at all', () => {
    expect(describePictures(evidence({ images: 0 }), true)).toBeUndefined()
  })
})

describe('describeReadingSupport', () => {
  it('reports narration from evidence, both ways', () => {
    const on = describeReadingSupport({ accessibility: undefined, pictures: undefined, hasMediaOverlays: true })
    expect(on[0]).toEqual({ tone: 'yes', text: 'Narrated, with the words highlighted as they are read.' })

    const off = describeReadingSupport({ accessibility: undefined, pictures: undefined, hasMediaOverlays: false })
    expect(off[0]?.tone).toBe('no')
  })

  it('warns about a declared hazard', () => {
    const notes = describeReadingSupport({
      accessibility: { features: [], hazards: ['flashing'], accessModes: [], summary: undefined },
      pictures: undefined,
      hasMediaOverlays: false,
    })
    expect(texts(notes)).toContain('The publisher warns of flashing images.')
  })

  it('marks the publisher’s claims as claims', () => {
    const notes = describeReadingSupport({
      accessibility: {
        features: ['displayTransformability', 'printPageNumbers'],
        hazards: [],
        accessModes: [],
        summary: undefined,
      },
      pictures: undefined,
      hasMediaOverlays: false,
    })
    const claim = notes.find((n) => n.tone === 'claim')
    expect(claim?.text).toBe(
      'The publisher says it lets its text be resized and respaced and keeps the printed page numbers.',
    )
  })

  it('does not restate a claim the pages were checked against', () => {
    // The book says it describes its pictures; the pages say otherwise. Printing
    // both would invite the reader to weigh a promise against a measurement.
    const notes = describeReadingSupport({
      accessibility: {
        features: ['alternativeText', 'synchronizedAudioText'],
        hazards: [],
        accessModes: [],
        summary: undefined,
      },
      pictures: { tone: 'no', text: 'The pictures are not described.' },
      hasMediaOverlays: true,
    })
    expect(notes.some((n) => n.tone === 'claim')).toBe(false)
    expect(texts(notes)).toContain('The pictures are not described.')
  })

  it('ignores vocabulary that means nothing for a picture book', () => {
    const notes = describeReadingSupport({
      accessibility: { features: ['MathML', 'chemistryML'], hazards: [], accessModes: [], summary: undefined },
      pictures: undefined,
      hasMediaOverlays: false,
    })
    expect(notes.some((n) => n.tone === 'claim')).toBe(false)
  })

  it('says something useful about a book that declares nothing at all', () => {
    const notes = describeReadingSupport({
      accessibility: undefined,
      pictures: undefined,
      hasMediaOverlays: false,
    })
    expect(notes).toHaveLength(1)
    expect(notes[0]?.text).toBeTruthy()
  })
})
