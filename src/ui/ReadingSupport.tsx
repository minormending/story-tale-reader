import { useMemo } from 'react'
import { describePictures, describeReadingSupport } from '../reader/readingSupport'
import type { ParsedBook } from '../engine/types'

/**
 * What this book will and will not do for the child reading it.
 *
 * EPUB has carried accessibility metadata for years and almost no reader shows it,
 * so the information exists and reaches nobody. Shown in the reading menu rather
 * than on the shelf: it is a question asked about the book in your hands, and the
 * shelf has to stay a wall of covers a child can point at.
 *
 * Every line says its meaning in words. The marks beside them are `aria-hidden`
 * decoration — a reader who cannot see the green tick still hears "the pictures
 * are not described", which is the part that matters.
 */
export function ReadingSupportSection({ book }: { book: ParsedBook }) {
  const notes = useMemo(() => {
    const pictures = book.altText
      ? describePictures(book.altText, book.layout === 'pre-paginated')
      : undefined
    return describeReadingSupport({
      accessibility: book.metadata.accessibility,
      pictures,
      hasMediaOverlays: book.hasMediaOverlays,
    })
  }, [book])

  if (notes.length === 0) return null

  return (
    <>
      <p className="menu-note">About this book</p>
      <ul className="support-list">
        {notes.map((note, i) => (
          <li key={i} className={`support support-${note.tone}`}>
            <span className="support-mark" aria-hidden="true">
              {note.tone === 'yes' ? '✓' : note.tone === 'no' ? '✗' : 'ℹ'}
            </span>
            <span>{note.text}</span>
          </li>
        ))}
      </ul>
      {book.metadata.accessibility?.summary && (
        <p className="menu-hint">{book.metadata.accessibility.summary}</p>
      )}
    </>
  )
}
