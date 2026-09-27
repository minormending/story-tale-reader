import { describe, it, expect } from 'vitest'
import { arrangeShelf, groupChoices } from './shelfGroups'
import type { LibraryEntry } from '../store/library'

let next = 0
const book = (title: string, extra: Partial<LibraryEntry> = {}): LibraryEntry => ({
  id: `b${++next}`,
  title,
  format: 'epub',
  fileName: `${title}.epub`,
  size: 1,
  addedAt: 0,
  lastOpenedAt: 0,
  pageCount: 10,
  layout: 'pre-paginated',
  hasMediaOverlays: false,
  ...extra,
})

const names = (layout: ReturnType<typeof arrangeShelf>) => layout.groups.map((g) => `${g.name} (${g.source})`)
const titles = (layout: ReturnType<typeof arrangeShelf>, name: string) =>
  layout.groups.find((g) => g.name === name)?.books.map((b) => b.title)

describe('arrangeShelf', () => {
  it('shows a group the reader made, even with one book in it', () => {
    const layout = arrangeShelf([book('Hotel Flamingo', { shelfGroup: 'Bedtime' }), book('Chicken on a Broom')])
    expect(names(layout)).toEqual(['Bedtime (manual)'])
    expect(layout.loose.map((b) => b.title)).toEqual(['Chicken on a Broom'])
  })

  it('treats group names that differ only in case and spacing as one group', () => {
    const layout = arrangeShelf([
      book('Hotel Flamingo', { shelfGroup: 'Bedtime' }),
      book('Chicken on a Broom', { shelfGroup: ' bedtime  ' }),
    ])
    expect(names(layout)).toEqual(['Bedtime (manual)'])
    expect(titles(layout, 'Bedtime')).toEqual(['Chicken on a Broom', 'Hotel Flamingo'])
  })

  it('still groups series automatically around the reader’s groups', () => {
    const layout = arrangeShelf([
      book('Tippie Book 1'),
      book('Tippie Book 2'),
      book('Hotel Flamingo', { shelfGroup: 'Bedtime' }),
    ])
    expect(names(layout)).toEqual(['Tippie (inferred)', 'Bedtime (manual)'])
  })

  it('takes a book the reader grouped out of the series the shelf would have put it in', () => {
    const layout = arrangeShelf([
      book('Tippie Book 1'),
      book('Tippie Book 2'),
      book('Tippie Book 3', { shelfGroup: 'Favourites' }),
    ])
    expect(titles(layout, 'Tippie')).toEqual(['Tippie Book 1', 'Tippie Book 2'])
    expect(titles(layout, 'Favourites')).toEqual(['Tippie Book 3'])
  })

  it('merges the reader’s group with a series of the same name', () => {
    // How a book the shelf missed gets into a series: put it in a group of that name.
    const layout = arrangeShelf([
      book('Bluey: The Decider', { series: 'Bluey' }),
      book('Bluey: Verandah Santa', { series: 'Bluey' }),
      book('Trains', { shelfGroup: 'bluey' }),
    ])
    expect(names(layout)).toEqual(['bluey (manual)'])
    expect(titles(layout, 'bluey')).toHaveLength(3)
  })

  it('keeps a book the reader took out of every group loose, whatever its title says', () => {
    const layout = arrangeShelf([
      book('Tippie Book 1'),
      book('Tippie Book 2'),
      book('Tippie Book 3', { shelfGroup: null }),
    ])
    expect(titles(layout, 'Tippie')).toEqual(['Tippie Book 1', 'Tippie Book 2'])
    expect(layout.loose.map((b) => b.title)).toEqual(['Tippie Book 3'])
  })

  it('places each group where its best-placed book would sit in the shelf’s order', () => {
    const layout = arrangeShelf([
      book('Newest', { shelfGroup: 'Later' }),
      book('Tippie Book 1'),
      book('Tippie Book 2'),
      book('Older', { shelfGroup: 'Later' }),
    ])
    expect(names(layout)).toEqual(['Later (manual)', 'Tippie (inferred)'])
  })
})

describe('groupChoices', () => {
  it('lists the reader’s groups first, then the series, with how many books each holds', () => {
    const choices = groupChoices([
      book('Tippie Book 1'),
      book('Tippie Book 2'),
      book('Hotel Flamingo', { shelfGroup: 'Bedtime' }),
    ])
    expect(choices).toEqual([
      { name: 'Bedtime', count: 1, source: 'manual' },
      { name: 'Tippie', count: 2, source: 'inferred' },
    ])
  })
})
