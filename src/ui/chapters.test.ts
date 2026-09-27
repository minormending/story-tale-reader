import { describe, it, expect } from 'vitest'
import { chapterAt, chapterMarks } from './chapters'
import type { NavItem } from '../engine/types'

const item = (label: string, path: string, children: NavItem[] = []): NavItem => ({
  label,
  href: path,
  path,
  fragment: '',
  children,
})

// A reading order of six documents, two to a spread after a cover that stands alone.
const spreadOf = (path: string): number => {
  const page = ['cover', 'p1', 'p2', 'p3', 'p4', 'p5'].indexOf(path)
  return page < 0 ? -1 : Math.ceil(page / 2)
}

describe('chapterMarks', () => {
  it('places each entry at the position its document is in, in reading order', () => {
    const marks = chapterMarks([item('Chapter 2', 'p3'), item('Cover', 'cover'), item('Chapter 1', 'p1')], spreadOf)
    expect(marks).toEqual([
      { position: 0, label: 'Cover' },
      { position: 1, label: 'Chapter 1' },
      { position: 2, label: 'Chapter 2' },
    ])
  })

  it('keeps the first entry to reach a position, and walks nested entries too', () => {
    const marks = chapterMarks([item('Part One', 'p1', [item('Opening', 'p2'), item('Later', 'p4')])], spreadOf)
    expect(marks).toEqual([
      { position: 1, label: 'Part One' },
      { position: 2, label: 'Later' },
    ])
  })

  it('leaves out entries that point outside the reading order or have no label', () => {
    expect(chapterMarks([item('Missing', 'nowhere'), item('  ', 'p1')], spreadOf)).toEqual([])
  })
})

describe('chapterAt', () => {
  const marks = [
    { position: 1, label: 'Chapter 1' },
    { position: 3, label: 'Chapter 2' },
  ]

  it('names the chapter a position falls in', () => {
    expect(chapterAt(marks, 1)).toBe('Chapter 1')
    expect(chapterAt(marks, 2)).toBe('Chapter 1')
    expect(chapterAt(marks, 5)).toBe('Chapter 2')
  })

  it('names nothing before the first chapter begins', () => {
    expect(chapterAt(marks, 0)).toBeUndefined()
    expect(chapterAt([], 3)).toBeUndefined()
  })
})
