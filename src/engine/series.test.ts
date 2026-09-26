import { describe, it, expect } from 'vitest'
import { authorKey, groupIntoSeries, type SeriesCandidate } from './series'

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

  /*
   * The cases below come from the test tablet's shelf, where each one split a series
   * or left a book out of it.
   */

  it('gathers undeclared books into a declared series their titles name', () => {
    const groups = groupIntoSeries([
      book("Bluey: Bluey's Big World", 'Bluey', { series: 'Bluey', seriesIndex: 0 }),
      book('Bluey: The Decider', 'Bluey', { series: 'Bluey', seriesIndex: 1 }),
      book('Bluey: Grandad', 'Bluey'),
      book('Bluey: Granny Mobile', 'Bluey'),
    ])
    expect(names(groups)).toEqual(['Bluey'])
    // Numbered books first, in their order; the rest after, alphabetically.
    expect(titles(groups, 'Bluey')).toEqual([
      "Bluey: Bluey's Big World", 'Bluey: The Decider', 'Bluey: Grandad', 'Bluey: Granny Mobile',
    ])
    expect(groups[0]?.source).toBe('inferred')
  })

  it('files a book under a series that is credited as its author', () => {
    // Licensed books often credit the brand: "Trains", by Bluey.
    const groups = groupIntoSeries([
      book('Bluey: The Decider', 'Bluey', { series: 'Bluey' }),
      book('Bluey: Verandah Santa', 'Bluey', { series: 'Bluey' }),
      book('Trains', 'Bluey'),
    ])
    expect(titles(groups, 'Bluey')).toContain('Trains')
  })

  it('groups a name before a colon when the author is the same', () => {
    const groups = groupIntoSeries([book('Bluey: Grandad', 'Bluey'), book('Bluey: Granny Mobile', 'Bluey')])
    expect(names(groups)).toEqual(['Bluey'])
  })

  it('does not group a name before a colon across different authors', () => {
    expect(groupIntoSeries([book('Frozen: A Sister More', 'One'), book('Frozen: The Ice Palace', 'Two')])).toEqual([])
  })

  it('merges a declared series with the title group it is plainly part of', () => {
    const groups = groupIntoSeries([
      book('Amelia Bedelia Is for the Birds', 'Herman Parish'),
      book('Amelia Bedelia Scared Silly', 'Herman Parish'),
      book('Amelia Bedelia Tries Her Luck', 'Peggy Parish', { series: 'Amelia Bedelia I Can Read Level 1', seriesIndex: 4 }),
    ])
    expect(names(groups)).toEqual(['Amelia Bedelia'])
    expect(titles(groups, 'Amelia Bedelia')).toHaveLength(3)
  })

  it('does not merge series whose shared name is one real word', () => {
    // "The Tale" is where Beatrix Potter's titles meet, not a series anyone else is in.
    const groups = groupIntoSeries([
      book('The Tale of Peter Rabbit', 'Beatrix Potter'),
      book('The Tale of Benjamin Bunny', 'Beatrix Potter'),
      book('The Tale of Despereaux', 'Kate DiCamillo', { series: 'The Tale of Despereaux' }),
      book('Despereaux Returns', 'Kate DiCamillo', { series: 'The Tale of Despereaux' }),
    ])
    expect(names(groups)).toEqual(['The Tale', 'The Tale of Despereaux'])
    expect(titles(groups, 'The Tale')).toHaveLength(2)
  })

  it('agrees an author written two ways, and reads numbers wherever the title puts them', () => {
    const groups = groupIntoSeries([
      book('Dragon Masters #6: Flight of the Moon Dragon', 'Tracey West'),
      book('Dragon Masters #2: Saving the Sun Dragon', 'West, Tracey'),
      book('Power of the Fire Dragon: A Branches Book (Dragon Masters #4)', 'Tracey West'),
    ])
    expect(names(groups)).toEqual(['Dragon Masters'])
    expect(titles(groups, 'Dragon Masters')).toEqual([
      'Dragon Masters #2: Saving the Sun Dragon',
      'Power of the Fire Dragon: A Branches Book (Dragon Masters #4)',
      'Dragon Masters #6: Flight of the Moon Dragon',
    ])
  })

  it('ignores roles after an author, and names the series as a title spells it', () => {
    const groups = groupIntoSeries([
      book('Never let a unicorn get spots!', 'Alber, Diane, author, illustrator'),
      book('Never Let a Unicorn Scribble!', 'Diane Alber'),
    ])
    expect(names(groups)).toEqual(['Never Let a Unicorn'])
  })

  it('lets a book with no author join a series its title opens with', () => {
    // A PDF without metadata: no author, and the file name for a title.
    const groups = groupIntoSeries([
      book('Fancy Nancy and the Mermaid Ballet', "Jane O'Connor"),
      book('Fancy Nancy and the Too-Loose Tooth', 'Jane O\u2019Connor'),
      book("Fancy Nancy Sees Stars -- O'Connor, Jane -- I Can Read 1"),
    ])
    expect(titles(groups, 'Fancy Nancy')).toHaveLength(3)
  })

  it('lets the first book, titled just the series name, join its sequels', () => {
    const groups = groupIntoSeries([
      book('Fancy Nancy', "Jane O'Connor"),
      book('Fancy Nancy: Best Reading Buddies', "Jane O'Connor"),
      book('Fancy Nancy: Spring Fashion Fling', "Jane O'Connor"),
    ])
    expect(titles(groups, 'Fancy Nancy')).toHaveLength(3)
  })

  it('does not let a different author join a series by title alone', () => {
    const groups = groupIntoSeries([
      book('Fancy Nancy and the Mermaid Ballet', "Jane O'Connor"),
      book('Fancy Nancy and the Too-Loose Tooth', "Jane O'Connor"),
      book('Fancy Nancy Knockoff', 'Someone Else'),
    ])
    expect(titles(groups, 'Fancy Nancy')).not.toContain('Fancy Nancy Knockoff')
  })

  it('does not show a declared series of one as a group', () => {
    expect(groupIntoSeries([book('Elmo Says Achoo!', 'Sarah Albee', { series: 'Step into Reading' })])).toEqual([])
  })
})

describe('authorKey', () => {
  it('agrees the ways one name is written', () => {
    const key = authorKey('Tracey West')
    expect(authorKey('West, Tracey')).toBe(key)
    expect(authorKey("O'Connor, Jane")).toBe(authorKey('Jane O\u2019Connor'))
    expect(authorKey('jane oconnor')).toBe(authorKey("Jane O'Connor"))
    expect(authorKey('Alber, Diane, author, illustrator')).toBe(authorKey('Diane Alber'))
  })

  it('takes the first of several authors', () => {
    expect(authorKey('Herman Parish; Lynne Avril')).toBe(authorKey('Herman Parish'))
    expect(authorKey('Peggy Parish & Herman Parish')).toBe(authorKey('Peggy Parish'))
    expect(authorKey("Jane O'Connor, Robin Preiss Glasser")).toBe(authorKey("Jane O'Connor"))
  })

  it('tells different people apart', () => {
    expect(authorKey('Herman Parish')).not.toBe(authorKey('Peggy Parish'))
    expect(authorKey(undefined)).toBeUndefined()
    expect(authorKey(' , ')).toBeUndefined()
  })
})
