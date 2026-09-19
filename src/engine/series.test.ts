import { describe, it, expect } from 'vitest'
import { groupIntoSeries, type SeriesCandidate } from './series'

/**
 * Grouping a shelf into series.
 *
 * The bias under test is against false grouping: filing two unrelated books together
 * looks broken, while missing a series only looks like a list. Most of these cases
 * are therefore about what must *not* group.
 */

let next = 0
const book = (title: string, creator?: string, extra: Partial<SeriesCandidate> = {}): SeriesCandidate => ({
  id: `b${++next}`,
  title,
  creator,
  ...extra,
})

const names = (groups: ReturnType<typeof groupIntoSeries>) => groups.map((g) => g.name)
const titles = (groups: ReturnType<typeof groupIntoSeries>, name: string) =>
  groups.find((g) => g.name === name)?.books.map((b) => b.title)

describe('groupIntoSeries', () => {
  it('takes a declared series at its word, and orders by the stated position', () => {
    const groups = groupIntoSeries([
      book('Blue', 'Someone', { series: 'Colours', seriesIndex: 2 }),
      book('Red', 'Someone', { series: 'Colours', seriesIndex: 1 }),
    ])
    expect(names(groups)).toEqual(['Colours'])
    expect(groups[0]?.source).toBe('declared')
    expect(titles(groups, 'Colours')).toEqual(['Red', 'Blue'])
  })

  it('groups a shared stem when the numbering says so, whoever wrote it', () => {
    const groups = groupIntoSeries([
      book('Tippie Book 2', 'One Author'),
      book('Tippie Book 10', 'Another Author'),
      book('Tippie Book 1', 'One Author'),
    ])
    expect(names(groups)).toEqual(['Tippie'])
    // Numeric, not lexical: 10 sorts after 2.
    expect(titles(groups, 'Tippie')).toEqual(['Tippie Book 1', 'Tippie Book 2', 'Tippie Book 10'])
  })

  it('reads a parenthesised volume as a volume', () => {
    const groups = groupIntoSeries([
      book('Learn to Read (Big Book 1)', 'A'),
      book('Learn to Read (Big Book 2)', 'A'),
    ])
    expect(names(groups)).toEqual(['Learn to Read'])
  })

  it('groups a shared opening when the author is the same', () => {
    const groups = groupIntoSeries([
      book('Amelia Bedelia Is for the Birds', 'Herman Parish'),
      book('Amelia Bedelia Helps Out', 'Herman Parish'),
    ])
    expect(names(groups)).toEqual(['Amelia Bedelia'])
  })

  it('groups a one-word series name when the shared opening is longer', () => {
    // Trimming "and the" off the shared prefix leaves a single word, which is the
    // series' actual name. Requiring two words in the finished name would lose a
    // whole shape of children's series.
    const groups = groupIntoSeries([
      book('Tippie and the Cat', 'A Author'),
      book('Tippie and the Hen', 'A Author'),
    ])
    expect(names(groups)).toEqual(['Tippie'])
  })

  it('does not group a shared opening across different authors', () => {
    // The whole point of the author check: "The Little" opens a hundred unrelated
    // picture books, and filing them together would be worse than not trying.
    expect(
      groupIntoSeries([
        book('The Little Engine That Could', 'Watty Piper'),
        book('The Little Prince', 'Antoine de Saint-Exupéry'),
      ]),
    ).toEqual([])
  })

  it('does not invent a series from a single book', () => {
    expect(groupIntoSeries([book('Tippie Book 1', 'A')])).toEqual([])
    expect(groupIntoSeries([book('Amelia Bedelia Helps Out', 'Herman Parish')])).toEqual([])
  })

  it('does not group on one shared word', () => {
    expect(
      groupIntoSeries([book('Winter Days', 'Same Author'), book('Winter Nights', 'Same Author')]),
    ).toEqual([])
  })

  it('does not group a book with its own sequel-less prefix', () => {
    // "Peter Rabbit" is entirely contained in the other title, so there is nothing
    // to distinguish a series from a book and its own subtitle.
    expect(
      groupIntoSeries([
        book('Peter Rabbit', 'Beatrix Potter'),
        book('Peter Rabbit', 'Beatrix Potter'),
      ]),
    ).toEqual([])
  })

  it('trims a name back off a connecting word', () => {
    const groups = groupIntoSeries([
      book('The Tale of Peter Rabbit', 'Beatrix Potter'),
      book('The Tale of Benjamin Bunny', 'Beatrix Potter'),
    ])
    // "The Tale of" would read as an unfinished phrase.
    expect(names(groups)).toEqual(['The Tale'])
  })

  it('leaves books that match nothing out of every group', () => {
    const groups = groupIntoSeries([
      book('Tippie Book 1', 'A'),
      book('Tippie Book 2', 'A'),
      book('Something Else Entirely', 'B'),
    ])
    expect(names(groups)).toEqual(['Tippie'])
    expect(groups.flatMap((g) => g.books.map((b) => b.title))).not.toContain('Something Else Entirely')
  })

  it('prefers what a book declares over what its title suggests', () => {
    const groups = groupIntoSeries([
      book('Tippie Book 1', 'A', { series: 'Learn to Read' }),
      book('Tippie Book 2', 'A', { series: 'Learn to Read' }),
    ])
    expect(names(groups)).toEqual(['Learn to Read'])
    expect(groups[0]?.source).toBe('declared')
  })
})
