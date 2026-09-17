import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SpreadView } from './SpreadView'
import { useFrameSize } from './useFrameSize'
import { applySpreadShift, buildSpreads, shouldPair } from '../engine/layout/spread'
import { modalViewport, DEFAULT_VIEWPORT } from '../engine/layout/viewport'
import { PageFrame } from './PageFrame'
import { PdfPage } from './PdfPage'
import { useReadAlong, type ReadAlongSettings } from './useReadAlong'
import { usePageKeys } from './usePageKeys'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { ZipArchive } from '../engine/zip/reader'
import type { BookPage, Direction, LayoutOverrides, ParsedBook, Spread } from '../engine/types'

export interface ViewerProps {
  bookId: string
  book: ParsedBook
  /** Present for EPUBs. */
  archive: ZipArchive | undefined
  /** Present for PDFs. */
  pdf?: PDFDocumentProxy
  /** Spine index to resume from. */
  initialPageIndex: number
  overrides: LayoutOverrides
  onOverridesChange: (next: LayoutOverrides) => void
  onPageIndexChange: (pageIndex: number) => void
  onClose: () => void
}

const SWIPE_THRESHOLD_PX = 40

export function Viewer({
  bookId,
  book,
  archive,
  pdf,
  initialPageIndex,
  overrides,
  onOverridesChange,
  onPageIndexChange,
  onClose,
}: ViewerProps) {
  const [stageRef, frame] = useFrameSize<HTMLDivElement>()
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

  /*
   * The reading position is a *page* index, not a spread index, and it is the only
   * piece of state. The spread index is derived from it, so regrouping the book —
   * rotating, toggling the shift, switching to single pages — keeps the reader on
   * the same page for free, and nothing can race to overwrite the resumed position.
   */
  const [pageIndex, setPageIndex] = useState(initialPageIndex)

  const spreadIndex = useMemo(() => {
    const found = spreads.findIndex(
      (s) =>
        s.center?.index === pageIndex || s.left?.index === pageIndex || s.right?.index === pageIndex,
    )
    return found === -1 ? 0 : found
  }, [spreads, pageIndex])

  const spread = spreads[spreadIndex]

  const notifyPage = useRef(onPageIndexChange)
  notifyPage.current = onPageIndexChange
  useEffect(() => {
    notifyPage.current(pageIndex)
  }, [pageIndex])

  const turn = useCallback(
    (delta: number) => {
      const target = spreads[Math.min(Math.max(spreadIndex + delta, 0), spreads.length - 1)]
      const first = leadPage(target, book.direction)
      if (first) setPageIndex(first.index)
    },
    [spreads, spreadIndex, book.direction],
  )

  // In a right-to-left book the "next" page is to the left.
  const forward = book.direction === 'rtl' ? -1 : 1

  const [readAlongSettings, setReadAlongSettings] = useState<ReadAlongSettings>({
    rate: 1,
    autoAdvance: true,
  })

  const readAlong = useReadAlong({
    book,
    archive,
    spread,
    direction: book.direction,
    settings: readAlongSettings,
    onFinishedSpread: () => turn(forward),
  })

  const onKey = useCallback(
    (event: KeyboardEvent): void => {
      if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') turn(forward)
      else if (event.key === 'ArrowLeft' || event.key === 'PageUp') turn(-forward)
      else if (event.key === 'Escape') {
        // Back out one level at a time rather than leaving the book from the menu.
        if (menuOpen) setMenuOpen(false)
        else onClose()
      }
    },
    [turn, forward, onClose, menuOpen],
  )

  useEffect(() => {
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onKey])

  const attachPageKeys = usePageKeys(onKey)

  const handlePageReady = useCallback(
    (doc: Document, page: BookPage) => {
      attachPageKeys(doc)
      readAlong.onPageReady(doc, page)
    },
    [attachPageKeys, readAlong],
  )

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

  const label = describePosition(spread, book.direction)
  const shift = overrides.spreadShift ?? 0

  return (
    <div className="viewer">
      <main
        className="stage"
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
      >
        {spread && (
          <SpreadView
            spread={spread}
            modal={modal}
            frame={frame}
            renderPage={(page, scale) =>
              pdf ? (
                <PdfPage document={pdf} page={page} scale={scale} />
              ) : (
                <PageFrame
                  bookId={bookId}
                  page={page}
                  scale={scale}
                  onReady={handlePageReady}
                />
              )
            }
          />
        )}
      </main>

      <header className={`chrome chrome-top${chromeVisible ? '' : ' hidden'}`}>
        <button
          className="icon-button"
          onClick={() => {
            readAlong.stop()
            onClose()
          }}
          aria-label="Back to library"
        >
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
        <div className="menu" role="group" aria-label="Fix layout">
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

          {book.hasMediaOverlays && (
            <>
              <hr className="menu-rule" />
              <p className="menu-note">Read-along</p>
              <div className="menu-row">
                {([0.75, 1, 1.25] as const).map((rate) => (
                  <button
                    key={rate}
                    className={`chip${readAlongSettings.rate === rate ? ' chip-on' : ''}`}
                    onClick={() => setReadAlongSettings((current) => ({ ...current, rate }))}
                  >
                    {rate === 1 ? 'Normal' : `${rate}\u00d7`}
                  </button>
                ))}
              </div>
              <button
                className="menu-item"
                onClick={() =>
                  setReadAlongSettings((current) => ({
                    ...current,
                    autoAdvance: !current.autoAdvance,
                  }))
                }
              >
                <span>Turn the page automatically</span>
                <span className="muted">{readAlongSettings.autoAdvance ? 'on' : 'off'}</span>
              </button>
              <p className="menu-hint">Tap any word to hear it read from there.</p>
              <hr className="menu-rule" />
            </>
          )}

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
        <div className="chrome-centre">
          {readAlong.available && (
            <button
              className={`play${readAlong.playing ? ' play-on' : ''}`}
              onClick={readAlong.toggle}
              aria-label={readAlong.playing ? 'Pause read-along' : 'Play read-along'}
            >
              {readAlong.playing ? '\u23f8' : '\u25b6'}
            </button>
          )}
          <span className="muted">
            {spreadIndex + 1} / {spreads.length}
          </span>
        </div>
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

/** The page a spread starts on in reading order. */
function leadPage(spread: Spread | undefined, direction: Direction): BookPage | undefined {
  if (!spread) return undefined
  return direction === 'rtl'
    ? (spread.right ?? spread.center ?? spread.left)
    : (spread.left ?? spread.center ?? spread.right)
}

function describePosition(spread: Spread | undefined, direction: Direction): string {
  if (!spread) return ''
  const name = (page: BookPage | undefined): string | undefined =>
    page ? (page.printedPage ?? String(page.index + 1)) : undefined
  const first = name(leadPage(spread, direction))
  const other = name(direction === 'rtl' ? spread.left : spread.right)
  if (first && other && first !== other) return `Pages ${first}–${other}`
  if (first) return `Page ${first}`
  return ''
}
