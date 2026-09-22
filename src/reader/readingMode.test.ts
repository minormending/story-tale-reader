import { describe, it, expect } from 'vitest'
import {
  asReadingMode,
  behaviourFor,
  DEFAULT_READING_MODE,
  MODE_LABELS,
  READING_MODES,
  type ReadingMode,
} from './readingMode'

describe('reading modes', () => {
  it('only one mode turns the page by itself', () => {
    const turners = READING_MODES.filter((mode) => behaviourFor(mode).autoAdvance)
    expect(turners).toEqual(['to-me'])
  })

  it('only the mode named for the child reading stays quiet', () => {
    const silent = READING_MODES.filter((mode) => !behaviourFor(mode).narrates)
    expect(silent).toEqual(['myself'])
  })

  it('shows the page-turn control again only where someone has to turn it', () => {
    // "Read to me" turns for you, so there is nothing to reach for; "Read myself"
    // never started narrating, so nothing finishes.
    const revealing = READING_MODES.filter((mode) => behaviourFor(mode).revealOnFinish)
    expect(revealing).toEqual(['together'])
  })

  it('never both turns the page and asks someone else to', () => {
    for (const mode of READING_MODES) {
      const { autoAdvance, revealOnFinish } = behaviourFor(mode)
      expect(autoAdvance && revealOnFinish).toBe(false)
    }
  })

  it('keeps the behaviour the reader had before modes existed as the default', () => {
    expect(DEFAULT_READING_MODE).toBe('to-me')
    expect(behaviourFor(DEFAULT_READING_MODE)).toMatchObject({ autoAdvance: true, narrates: true })
  })

  it('names every mode it offers', () => {
    for (const mode of READING_MODES) {
      expect(MODE_LABELS[mode].name).toBeTruthy()
      expect(MODE_LABELS[mode].hint).toBeTruthy()
    }
  })
})

describe('asReadingMode', () => {
  it('takes a stored mode at its word', () => {
    for (const mode of READING_MODES) expect(asReadingMode(mode)).toBe(mode)
  })

  it('falls back rather than trusting whatever was in storage', () => {
    // A mode dropped in a later version, a hand-edited database, a half-written
    // record: the reader still has to open the book.
    for (const junk of [undefined, null, '', 'read-to-me', 42, {}, ['to-me']]) {
      expect(asReadingMode(junk)).toBe(DEFAULT_READING_MODE)
    }
  })

  it('is total over the modes it advertises', () => {
    // behaviourFor is indexed by the same union, so a mode added to READING_MODES
    // without a behaviour would surface here rather than as undefined at runtime.
    for (const mode of READING_MODES) {
      expect(behaviourFor(mode as ReadingMode)).toBeDefined()
    }
  })
})
