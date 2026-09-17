import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { parseClockValue, parseSmil, fragmentAt } from './smil'
import { ZipArchive, bufferSource } from '../zip/reader'

describe('parseClockValue', () => {
  it('parses full and partial clock values', () => {
    expect(parseClockValue('00:02:23.297')).toBeCloseTo(143.297, 3)
    expect(parseClockValue('02:23.297')).toBeCloseTo(143.297, 3)
    expect(parseClockValue('1:00:00')).toBe(3600)
    expect(parseClockValue('00:00:00.062')).toBeCloseTo(0.062, 3)
  })

  it('parses timecount values with units', () => {
    expect(parseClockValue('23.297s')).toBeCloseTo(23.297, 3)
    expect(parseClockValue('300ms')).toBeCloseTo(0.3, 3)
    expect(parseClockValue('2.5min')).toBe(150)
    expect(parseClockValue('1h')).toBe(3600)
    expect(parseClockValue('12')).toBe(12)
  })

  it('tolerates the npt= prefix and whitespace', () => {
    expect(parseClockValue(' npt=12.5s ')).toBeCloseTo(12.5, 3)
  })

  it('rejects nonsense', () => {
    expect(parseClockValue('')).toBeUndefined()
    expect(parseClockValue(undefined)).toBeUndefined()
    expect(parseClockValue('later')).toBeUndefined()
  })
})

const SMIL = `<?xml version="1.0" encoding="UTF-8"?>
<smil xmlns="http://www.w3.org/ns/SMIL" version="3.0"><body>
<seq>
<par id="p1"><text src="../page012.xhtml#word1"/><audio src="../audio/book.m4a" clipBegin="00:02:23.297" clipEnd="00:02:25.523"/></par>
<par id="p2"><text src="../page012.xhtml#word2"/><audio src="../audio/book.m4a" clipBegin="00:02:25.523" clipEnd="00:02:25.795"/></par>
</seq>
<par id="p3"><text src="../page012.xhtml#word3"/><audio src="../audio/book.m4a" clipBegin="00:02:25.795" clipEnd="00:02:26.902"/></par>
<par id="bad"><text src="../page012.xhtml"/><audio src="../audio/book.m4a" clipBegin="0" clipEnd="1"/></par>
</body></smil>`

describe('parseSmil', () => {
  it('flattens nested seq elements and resolves paths', () => {
    const fragments = parseSmil(SMIL, 'OEBPS/smil/page012.smil')
    expect(fragments.length).toBe(3)
    expect(fragments[0]).toEqual({
      textPath: 'OEBPS/page012.xhtml',
      fragment: 'word1',
      audioPath: 'OEBPS/audio/book.m4a',
      start: expect.closeTo(143.297, 3),
      end: expect.closeTo(145.523, 3),
    })
  })

  it('skips a par whose text reference has no fragment', () => {
    expect(parseSmil(SMIL, 'OEBPS/smil/page012.smil').every((f) => f.fragment)).toBe(true)
  })
})

describe('fragmentAt', () => {
  const fragments = parseSmil(SMIL, 'OEBPS/smil/page012.smil')

  it('finds the fragment covering a time', () => {
    expect(fragmentAt(fragments, 143.5)).toBe(0)
    expect(fragmentAt(fragments, 145.6)).toBe(1)
    expect(fragmentAt(fragments, 146.0)).toBe(2)
  })

  it('returns -1 before the first fragment', () => {
    expect(fragmentAt(fragments, 0)).toBe(-1)
  })

  it('holds the last passed fragment in a gap rather than flickering off', () => {
    expect(fragmentAt(fragments, 999)).toBe(2)
  })

  it('resolves the 62ms word that timeupdate would skip', () => {
    // word12 in the reference book: 00:02:30.171 -> 00:02:30.233
    const tiny = [
      { textPath: 'p', fragment: 'a', audioPath: 'a', start: 150.171, end: 150.233 },
      { textPath: 'p', fragment: 'b', audioPath: 'a', start: 150.233, end: 150.975 },
    ]
    expect(fragmentAt(tiny, 150.2)).toBe(0)
    expect(fragmentAt(tiny, 150.5)).toBe(1)
  })
})

const REFERENCE_BOOK = 'corpus/local/amelia-bedelia-birds.epub'
describe.skipIf(!existsSync(REFERENCE_BOOK))('parseSmil against the reference book', () => {
  it('reads the real per-word timings for page 12', async () => {
    const archive = await ZipArchive.open(bufferSource(readFileSync(REFERENCE_BOOK)))
    const fragments = parseSmil(
      await archive.readText('OEBPS/smil/page012.smil'),
      'OEBPS/smil/page012.smil',
    )

    expect(fragments.length).toBe(29)
    expect(fragments[0]!.fragment).toBe('word1')
    expect(fragments[0]!.textPath).toBe('OEBPS/page012.xhtml')
    expect(fragments[0]!.audioPath).toBe('OEBPS/audio/abforthebirds.m4a')
    expect(fragments[0]!.start).toBeCloseTo(143.297, 3)

    // The word that makes rAF polling mandatory: "a", 62ms long.
    const shortest = fragments.reduce((a, b) => (b.end - b.start < a.end - a.start ? b : a))
    expect(shortest.end - shortest.start).toBeLessThan(0.07)

    // Fragments never overlap and never run backwards.
    for (let i = 1; i < fragments.length; i++) {
      expect(fragments[i]!.start).toBeGreaterThanOrEqual(fragments[i - 1]!.end - 0.001)
    }
  })
})
