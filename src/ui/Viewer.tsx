import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SpreadView, fitScale, spreadContentSize } from './SpreadView'
import { useFrameSize } from './useFrameSize'
import { applySpreadShift, buildSpreads, shouldPair } from '../engine/layout/spread'
import { modalViewport, DEFAULT_VIEWPORT } from '../engine/layout/viewport'
import { PageFrame } from './PageFrame'
import { PdfPage } from './PdfPage'
import { useReadAlong, type ReadAlongSettings } from './useReadAlong'
import { usePageKeys } from './usePageKeys'
import { usePageGestures } from './usePageGestures'
import { useWakeLock } from './useWakeLock'
import { useChromeAutoHide } from './useChromeAutoHide'
import { LockButton } from './LockButton'
import { BookmarkToggle, BookmarksSection } from './Bookmarks'
import { ContentsSection } from './Contents'
import { addBookmark, listBookmarks, removeBookmark, type Bookmark } from '../store/bookmarks'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { InlinePageResolver } from '../vfs/inline'
import { isVfsReady } from '../vfs/client'
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
  const [locked, setLocked] = useState(false)

  // A picture book is read slowly enough to outlast a screen timeout.
  useWakeLock(true)

  // The bars are drawn over the page; let them retire so it can be seen whole.
  useChromeAutoHide(chromeVisible, () => setChromeVisible(false), menuOpen)

  const modal = useMemo(
    () => modalViewport(book.pages.map((page) => page.viewport)) ?? DEFAULT_VIEWPORT,
    [book],
  )

  // Without a service worker the pages cannot be fetched over HTTP, so each one is
  // inlined and handed to its iframe directly.
  const inline = useMemo(
    () => (archive && !isVfsReady() ? new InlinePageResolver(archive) : undefined),
    [archive],
  )
  useEffect(() => () => inline?.dispose(), [inline])
  const resolveInline = useMemo(
    () => (inline ? (path: string) => inline.page(path) : undefined),
    [inline],
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

  /** Returns whether the book actually moved — false at either end. */
  const turn = useCallback(
    (delta: number): boolean => {
      const targetIndex = Math.min(Math.max(spreadIndex + delta, 0), spreads.length - 1)
      if (targetIndex === spreadIndex) return false
      const first = leadPage(spreads[targetIndex], book.direction)
      if (!first) return false
      setPageIndex(first.index)
      return true
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

  // The drawn size of the spread, which bounds how far a zoomed page can be panned.
  const rendered = useMemo(() => {
    if (!spread) return { width: 0, height: 0 }
    const content = spreadContentSize(spread, modal)
    const fit = fitScale(content, frame)
    return { width: content.width * fit, height: content.height * fit }
  }, [spread, modal, frame])

  // Declared after read-along so a tap on a narrated word can be handed to it
  // rather than turning the page.
  const gestures = usePageGestures({
    onTurn: (direction) => turn(direction * forward),
    onToggleChrome: () => setChromeVisible((visible) => !visible),
    claimTap: readAlong.claimsTap,
    bounds: { frame, content: rendered },
  })

  const { zoom, pan } = gestures.transform
  const zoomed = zoom > 1.02

  // A new spread starts unzoomed: carrying a 4x zoom across a page turn leaves the
  // reader looking at a corner of a picture they have not seen yet.
  useEffect(() => {
    gestures.resetZoom()
  }, [pageIndex, gestures.resetZoom])

  const onKey = useCallback(
    (event: KeyboardEvent): void => {
      if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') turn(forward)
      else if (event.key === 'ArrowLeft' || event.key === 'PageUp') turn(-forward)
      else if (event.key === 'Escape') {
        // Back out one level at a time rather than leaving the book from the menu.
        if (menuOpen) setMenuOpen(false)
        // Lock mode takes away every way out of the book, keyboard included.
        else if (!locked) onClose()
      }
    },
    [turn, forward, onClose, menuOpen, locked],
  )

  useEffect(() => {
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onKey])

  useEffect(() => {
    const previous = document.title
    document.title = `${book.metadata.title} \u2014 Story Tale Reader`
    return () => {
      document.title = previous
    }
  }, [book.metadata.title])

  const attachPageKeys = usePageKeys(onKey)

  const handlePageReady = useCallback(
    (doc: Document, page: BookPage) => {
      attachPageKeys(doc)
      gestures.attachToPage(doc)
      readAlong.onPageReady(doc, page)
    },
    [attachPageKeys, gestures, readAlong],
  )

  /* ------------------------------ bookmarks ------------------------------ */

  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  useEffect(() => {
    void listBookmarks(bookId).then(setBookmarks)
  }, [bookId])

  const label = describePosition(spread, book.direction)
  const here = leadPage(spread, book.direction)
  // A fixed-layout bookmark is a spine index: nothing the reader changes moves it.
  const bookmarkHere = bookmarks.find((bookmark) => bookmark.pageIndex === here?.index)

  const toggleBookmark = useCallback(async () => {
    if (bookmarkHere) await removeBookmark(bookmarkHere.id)
    else if (here) {
      await addBookmark({
        bookId,
        pageIndex: here.index,
        label: label || `Page ${here.index + 1}`,
      })
    }
    setBookmarks(await listBookmarks(bookId))
  }, [bookmarkHere, here, bookId, label])

  const removeAt = useCallback(
    async (bookmark: Bookmark) => {
      await removeBookmark(bookmark.id)
      setBookmarks(await listBookmarks(bookId))
    },
    [bookId],
  )
  const shift = overrides.spreadShift ?? 0

  return (
    // Locked means a child is holding this, so the controls that remain grow to
    // suit smaller hands — see docs/child-reading-research.md.
    <div className={`viewer${locked ? ' viewer-locked' : ''}`}>
      <main className="stage" ref={stageRef} {...gestures.stageProps}>
        {spread && (
          <div
            className="zoom-layer"
            style={
              zoomed
                ? { transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }
                : undefined
            }
          >
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
                  resolveInline={resolveInline}
                />
              )
            }
          />
          </div>
        )}
      </main>

      <header className={`chrome chrome-top${chromeVisible ? '' : ' hidden'}`}>
        {locked ? (
          <span className="chrome-spacer" />
        ) : (
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
        )}
        <div className="chrome-title">
          <h1>{book.metadata.title}</h1>
          <span className="muted">{label}</span>
        </div>
        <div className="chrome-actions">
          {!locked && (
            <>
              <BookmarkToggle
                bookmarked={bookmarkHere !== undefined}
                onToggle={() => void toggleBookmark()}
              />
              <button
                className="icon-button"
                onClick={() => setMenuOpen((open) => !open)}
                aria-expanded={menuOpen}
              >
                Fix layout
              </button>
            </>
          )}
          <LockButton
            locked={locked}
            onLock={() => {
              setMenuOpen(false)
              setLocked(true)
            }}
            onUnlock={() => setLocked(false)}
          />
        </div>
      </header>

      {menuOpen && (
        <div className="menu" role="group" aria-label="Reading options">
          <ContentsSection
            items={book.nav}
            currentPaths={[spread?.center?.path, spread?.left?.path, spread?.right?.path].filter(
              (path): path is string => path !== undefined,
            )}
            onJump={(item) => {
              // A fixed page has no interior to scroll to, so the fragment is
              // dropped: the entry's page is the whole of what it can mean here.
              const target = book.pages.findIndex((candidate) => candidate.path === item.path)
              if (target === -1) return
              setPageIndex(target)
              setMenuOpen(false)
            }}
          />
          <BookmarksSection
            bookmarks={bookmarks}
            onJump={(bookmark) => {
              setPageIndex(bookmark.pageIndex)
              setMenuOpen(false)
            }}
            onRemove={(bookmark) => void removeAt(bookmark)}
          />
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
          {zoomed ? (
            <button className="icon-button" onClick={gestures.resetZoom}>
              {zoom.toFixed(1)}&times; &middot; reset
            </button>
          ) : (
            <span className="muted">
              {spreadIndex + 1} / {spreads.length}
            </span>
          )}
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
