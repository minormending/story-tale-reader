import { describe, it, expect } from 'vitest'
import { addTap, displayWord, MAX_WORDS, sortWords, wordKey, type TappedWord } from './wordList'

let seq = 0
const tap = (text: string, pageIndex = 0, elementId = 'w1', order = seq++) => ({
  text,
  pageIndex,
  elementId,
  order,
})

describe('wordKey', () => {
  it('folds case and edge punctuation to one identity', () => {
    // A child who tapped `"Rabbit,` and later `rabbit` asked about one word.
    expect(wordKey('"Rabbit,')).toBe('rabbit')
    expect(wordKey('rabbit')).toBe('rabbit')
    expect(wordKey('  Rabbit!  ')).toBe('rabbit')
  })

  it('keeps accents, because the word is the content here', () => {
    // Unlike the shelf search, folding "José" would change what the book said.
    expect(wordKey('José')).toBe('josé')
  })

  it('keeps punctuation inside a word', () => {
    expect(wordKey("don't")).toBe("don't")
    expect(wordKey('well-loved')).toBe('well-loved')
  })

  it('is empty for something that is not a word', () => {
    for (const junk of ['', '   ', '—', '...', '!']) expect(wordKey(junk)).toBe('')
  })
})

describe('displayWord', () => {
  it('shows the book’s own spelling, tidied', () => {
    expect(displayWord('  The\n  Rabbit ')).toBe('The Rabbit')
    expect(displayWord('Rabbit')).toBe('Rabbit')
  })
})

describe('addTap', () => {
  it('records a word the first time', () => {
    const out = addTap([], tap('rabbit', 3, 'w3-2', 7))
    expect(out).toEqual([
      { key: 'rabbit', text: 'rabbit', pageIndex: 3, elementId: 'w3-2', order: 7, taps: 1 },
    ])
  })

  it('counts a repeat rather than listing it twice', () => {
    // The count is the useful part: a word misheard once is not a word that
    // stopped the child three times.
    let words = addTap([], tap('Rabbit', 3, 'w3-2'))
    words = addTap(words, tap('rabbit,', 5, 'w5-1'))
    words = addTap(words, tap('"RABBIT"', 6, 'w6-1'))
    expect(words).toHaveLength(1)
    expect(words[0]?.taps).toBe(3)
  })

  it('keeps where the word was first met, so the list can go back to it', () => {
    let words = addTap([], tap('rabbit', 3, 'w3-2', 4))
    words = addTap(words, tap('rabbit', 9, 'w9-4', 40))
    expect(words[0]?.pageIndex).toBe(3)
    expect(words[0]?.elementId).toBe('w3-2')
    expect(words[0]?.order).toBe(4)
  })

  it('ignores a tap that is not on a word', () => {
    const before: TappedWord[] = []
    expect(addTap(before, tap('   '))).toBe(before)
    expect(addTap(before, tap('—'))).toBe(before)
  })

  it('stops collecting once the list is past reviewing', () => {
    let words: TappedWord[] = []
    for (let i = 0; i < MAX_WORDS + 10; i++) words = addTap(words, tap(`word${i}`, i, `w${i}`))
    expect(words).toHaveLength(MAX_WORDS)
  })

  it('still counts repeats of words it already has when full', () => {
    // The cap is on new rows, not on learning that word3 is still hard.
    let words: TappedWord[] = []
    for (let i = 0; i < MAX_WORDS; i++) words = addTap(words, tap(`word${i}`, i, `w${i}`))
    const after = addTap(words, tap('word3', 99, 'wX'))
    expect(after).toHaveLength(MAX_WORDS)
    expect(after.find((w) => w.key === 'word3')?.taps).toBe(2)
  })

  it('does not disturb the list it was given', () => {
    const before = addTap([], tap('rabbit'))
    const after = addTap(before, tap('badger', 1, 'w2'))
    expect(before).toHaveLength(1)
    expect(after).toHaveLength(2)
  })
})

describe('sortWords', () => {
  it('reads in story order, not as a ranking of failures', () => {
    const words: TappedWord[] = [
      { key: 'badger', text: 'badger', pageIndex: 9, elementId: 'a', order: 30, taps: 7 },
      { key: 'rabbit', text: 'rabbit', pageIndex: 2, elementId: 'b', order: 5, taps: 1 },
    ]
    expect(sortWords(words).map((w) => w.key)).toEqual(['rabbit', 'badger'])
  })

  it('keeps the order the words are read in, not the alphabet', () => {
    // The bug this replaced: every word on a spread shares a page, so sorting by
    // page and breaking ties on the key turned "Once upon a" into "a, Once, upon".
    const words: TappedWord[] = [
      { key: 'once', text: 'Once', pageIndex: 0, elementId: 'w1-1', order: 0, taps: 1 },
      { key: 'upon', text: 'upon', pageIndex: 0, elementId: 'w1-2', order: 1, taps: 1 },
      { key: 'a', text: 'a', pageIndex: 0, elementId: 'w1-3', order: 2, taps: 1 },
    ]
    expect(sortWords(words).map((w) => w.text)).toEqual(['Once', 'upon', 'a'])
  })

  it('leaves the array it was given alone', () => {
    const words: TappedWord[] = [
      { key: 'b', text: 'b', pageIndex: 9, elementId: 'a', order: 9, taps: 1 },
      { key: 'a', text: 'a', pageIndex: 2, elementId: 'b', order: 2, taps: 1 },
    ]
    sortWords(words)
    expect(words.map((w) => w.key)).toEqual(['b', 'a'])
  })
})
