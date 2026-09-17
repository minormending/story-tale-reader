import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SpreadView } from './SpreadView'
import { useFrameSize } from './useFrameSize'
import { applySpreadShift, buildSpreads, shouldPair } from '../engine/layout/spread'
import { modalViewport, DEFAULT_VIEWPORT } from '../engine/layout/viewport'
import type { BookPage, LayoutOverrides, ParsedBook } from '../engine/types'

export interface ViewerProps {
  bookId: string
  book: ParsedBook
  overrides: LayoutOverrides
  onOverridesChange: (next: LayoutOverrides) => void
  onClose: () => void
}

const SWIPE_THRESHOLD_PX = 40

export function Viewer({ bookId, book, overrides, onOverridesChange, onClose }: ViewerProps) {
  const [stageRef, frame] = useFrameSize<HTMLDivElement>()
  const [spreadIndex, setSpreadIndex] = useState(0)
  const [chromeVisible, setChromeVisible] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)

  const modal = useMemo(
    () => modalViewport(book.pages.map((page) => page.viewport)) ?? DEFAULT_VIEWPORT,
    [book],
  )

  const paired = shouldPair(book.spread, frame, overrides.spreadMode ?? 'auto')

  const pages = useMemo(
    () => applySpreadShift(book.pages, overrides.spreadShift ?? 0),
    [book.pages, overrides.spreadShift],
  )

  const spreads = useMemo(
    () => buildSpreads(pages, book.direction, paired),
    [pages, book.direction, paired],
  )

  // Keep the reader on roughly the same page when the spread grouping changes
  // (rotation, a shift toggle, switching to single-page).
  const currentPageIndex = useRef(0)
  useEffect(() => {
    const target = currentPageIndex.current
    const found = spreads.findIndex(
      (s) => s.center?.index === target || s.left?.index === target || s.right?.index === target,
    )
    setSpreadIndex(found === -1 ? 0 : found)
  }, [spreads])

  const spread = spreads[Math.min(spreadIndex, spreads.length - 1)]
  useEffect(() => {
    const first = spread?.left ?? spread?.center ?? spread?.right
    if (first) currentPageIndex.current = first.index
  }, [spread])

  const turn = useCallback(
    (delta: number) => {
      setSpreadIndex((index) => Math.min(Math.max(index + delta, 0), spreads.length - 1))
    },
    [spreads.length],
  )

  // In a right-to-left book the "next" page is to the left.
  const forward = book.direction === 'rtl' ? -1 : 1

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') turn(forward)
      else if (event.key === 'ArrowLeft' || event.key === 'PageUp') turn(-forward)
      else if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [turn, forward, onClose])

  const pointerStart = useRef<{ x: number; y: number } | null>(null)
  const onPointerDown = (event: React.PointerEvent): void => {
    pointerStart.current = { x: event.clientX, y: event.clientY }
  }
  const onPointerUp = (event: React.PointerEvent): void => {
    const start = pointerStart.current
    pointerStart.current = null
    if (!start) return

    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (Math.abs(dx) > SWIPE_THRESHOLD_PX && Math.abs(dx) > Math.abs(dy)) {
      turn(dx < 0 ? forward : -forward)
      return
    }
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10) return

    // A tap: edges turn the page, the middle shows the controls.
    const bounds = event.currentTarget.getBoundingClientRect()
    const position = (event.clientX - bounds.left) / bounds.width
    if (position < 0.3) turn(-forward)
    else if (position > 0.7) turn(forward)
    else setChromeVisible((visible) => !visible)
  }

  const label = describePosition(spread?.left ?? spread?.center, spread?.right)
  const shift = overrides.spreadShift ?? 0

  return (
    <div className="viewer">
      <div
        className="stage"
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
      >
        {spread && <SpreadView bookId={bookId} spread={spread} modal={modal} frame={frame} />}
      </div>

      <header className={`chrome chrome-top${chromeVisible ? '' : ' hidden'}`}>
        <button className="icon-button" onClick={onClose} aria-label="Back to library">
          ‹ Library
        </button>
        <div className="chrome-title">
          <strong>{book.metadata.title}</strong>
          <span className="muted">{label}</span>
        </div>
        <button
          className="icon-button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-expanded={menuOpen}
        >
          Fix layout
        </button>
      </header>

      {menuOpen && (
        <div className="menu" role="dialog" aria-label="Fix layout">
          <p className="menu-note">
            {book.layout === 'pre-paginated' ? 'Fixed layout' : 'Reflowable'}
            {book.layoutInferred ? ' (detected)' : ''} · pairing from{' '}
            {book.spreadSource === 'page-list'
              ? 'printed page numbers'
              : book.spreadSource === 'explicit'
                ? 'the book’s own spread hints'
                : 'page order'}
          </p>

          <button
            className="menu-item"
            onClick={() => onOverridesChange({ ...overrides, spreadShift: shift === 1 ? 0 : 1 })}
          >
            <span>Shift spread pairing</span>
            <span className="muted">{shift === 1 ? 'shifted' : 'normal'}</span>
          </button>
          <p className="menu-hint">
            Use this if the two halves of a picture don&rsquo;t line up, or the words sit on
            the wrong page.
          </p>

          <div className="menu-row">
            {(['auto', 'single', 'double'] as const).map((mode) => (
              <button
                key={mode}
                className={`chip${(overrides.spreadMode ?? 'auto') === mode ? ' chip-on' : ''}`}
                onClick={() => onOverridesChange({ ...overrides, spreadMode: mode })}
              >
                {mode === 'auto' ? 'Auto' : mode === 'single' ? 'One page' : 'Two pages'}
              </button>
            ))}
          </div>
        </div>
      )}

      <footer className={`chrome chrome-bottom${chromeVisible ? '' : ' hidden'}`}>
        <button className="icon-button" onClick={() => turn(-forward)} disabled={spreadIndex === 0}>
          Previous
        </button>
        <span className="muted">
          {spreadIndex + 1} / {spreads.length}
        </span>
        <button
          className="icon-button"
          onClick={() => turn(forward)}
          disabled={spreadIndex >= spreads.length - 1}
        >
          Next
        </button>
      </footer>
    </div>
  )
}

function describePosition(first: BookPage | undefined, second: BookPage | undefined): string {
  const name = (page: BookPage | undefined): string | undefined =>
    page ? (page.printedPage ?? String(page.index + 1)) : undefined
  const a = name(first)
  const b = name(second)
  if (a && b) return `Pages ${a}–${b}`
  if (a) return `Page ${a}`
  return ''
}
