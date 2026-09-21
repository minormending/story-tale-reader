import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ReflowableStage } from './ReflowableStage'
import { useFrameSize } from './useFrameSize'
import { usePageKeys } from './usePageKeys'
import { usePageGestures } from './usePageGestures'
import { useWakeLock } from './useWakeLock'
import { useChromeAutoHide } from './useChromeAutoHide'
import { LockButton } from './LockButton'
import { BookmarkToggle, BookmarksSection } from './Bookmarks'
import { ContentsSection } from './Contents'
import { captureAnchor, screenForAnchor, screenForFragment } from '../reader/anchor'
import { addBookmark, listBookmarks, removeBookmark, type Bookmark } from '../store/bookmarks'
import { DEFAULT_TYPOGRAPHY, type ReaderFont, type ReaderTheme, type Typography } from '../reader/typography'
import { InlinePageResolver } from '../vfs/inline'
import { isVfsReady } from '../vfs/client'
import type { ZipArchive } from '../engine/zip/reader'
import type { NavItem, ParsedBook } from '../engine/types'

export interface ReflowableViewerProps {
  bookId: string
  book: ParsedBook
  archive: ZipArchive | undefined
  initialPageIndex: number
  initialScreen: number
  /** The element the reader left off at, when one was recorded. */
  initialAnchor?: number
  onPositionChange: (pageIndex: number, screen: number, anchor?: number) => void
  onClose: () => void
}

/** Sentinel for "put me on the last screen of the section I just stepped back into". */
const LAST_SCREEN = -1

export function ReflowableViewer({
  bookId,
  book,
  archive,
  initialPageIndex,
  initialScreen,
  initialAnchor,
  onPositionChange,
  onClose,
}: ReflowableViewerProps) {
  const [stageRef, frame] = useFrameSize<HTMLDivElement>()
  const [chromeVisible, setChromeVisible] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const [locked, setLocked] = useState(false)

  useWakeLock(true)

  // The bars are drawn over the page; let them retire so it can be read whole.
  useChromeAutoHide(chromeVisible, () => setChromeVisible(false), menuOpen)

  const [typography, setTypography] = useState<Typography>(DEFAULT_TYPOGRAPHY)

  const inline = useMemo(
    () => (archive && !isVfsReady() ? new InlinePageResolver(archive) : undefined),
    [archive],
  )
  useEffect(() => () => inline?.dispose(), [inline])
  const resolveInline = useMemo(
    () => (inline ? (path: string) => inline.page(path) : undefined),
    [inline],
  )

  const sections = useMemo(() => book.pages.filter((page) => page.linear), [book.pages])
  const [sectionIndex, setSectionIndex] = useState(() =>
    Math.max(0, sections.findIndex((page) => page.index === initialPageIndex)),
  )
  const [screen, setScreen] = useState(initialScreen)
  const [screenCount, setScreenCount] = useState(1)

  const section = sections[Math.min(sectionIndex, sections.length - 1)]

  const notify = useRef(onPositionChange)
  notify.current = onPositionChange

  /** The page document, for measuring anchors. */
  const docRef = useRef<Document | null>(null)
  /**
   * Bumped whenever a section's document becomes available.
   *
   * A fresh iframe has no usable document until it loads, which happens after the
   * effects of the render that mounted it. Anything that measures the page has to
   * re-run at that point, or it measures the section the reader just left.
   */
  const [docGeneration, setDocGeneration] = useState(0)
  const frameWidthRef = useRef(0)
  frameWidthRef.current = frame.width
  /**
   * An anchor waiting for its section to finish laying out before it can resolve.
   * Seeded with the resumed position, so reopening a book lands on the text the
   * reader left off at rather than on a screen number that the current type size
   * may have moved.
   */
  const pendingAnchor = useRef<number | undefined>(initialAnchor)

  /** The same, for a contents entry, which names its target by id rather than index. */
  const pendingFragment = useRef<string | undefined>(undefined)

  const onMeasured = useCallback((count: number) => {
    setScreenCount(count)

    // A bookmark jumped into this section; only now that it has columns can the
    // anchored element be asked which screen it fell on.
    const anchor = pendingAnchor.current
    if (anchor !== undefined) {
      pendingAnchor.current = undefined
      const doc = docRef.current
      const resolved = doc ? screenForAnchor(doc, frameWidthRef.current, anchor) : undefined
      if (resolved !== undefined) {
        setScreen(Math.min(resolved, count - 1))
        return
      }
    }

    // A contents entry jumped here, pointing at an element rather than a position.
    const fragment = pendingFragment.current
    if (fragment !== undefined) {
      pendingFragment.current = undefined
      const doc = docRef.current
      const resolved = doc ? screenForFragment(doc, frameWidthRef.current, fragment) : undefined
      // An entry naming an id the section does not contain still opens the section,
      // at its start: the chapter is the part the reader asked for.
      setScreen(resolved === undefined ? 0 : Math.min(resolved, count - 1))
      return
    }

    // Resolve a backwards page turn that landed at the end of the previous section.
    setScreen((current) => (current === LAST_SCREEN ? count - 1 : Math.min(current, count - 1)))
  }, [])

  const turn = useCallback(
    (delta: number) => {
      setScreen((current) => {
        const next = current + delta
        if (next >= 0 && next < screenCount) return next

        if (next >= screenCount && sectionIndex < sections.length - 1) {
          setSectionIndex(sectionIndex + 1)
          return 0
        }
        if (next < 0 && sectionIndex > 0) {
          setSectionIndex(sectionIndex - 1)
          return LAST_SCREEN
        }
        return current
      })
    },
    [screenCount, sectionIndex, sections.length],
  )

  const forward = book.direction === 'rtl' ? -1 : 1

  const onKey = useCallback(
    (event: KeyboardEvent): void => {
      if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') turn(forward)
      else if (event.key === 'ArrowLeft' || event.key === 'PageUp') turn(-forward)
      else if (event.key === 'Escape') {
        if (menuOpen) setMenuOpen(false)
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

  const gestures = usePageGestures({
    onTurn: (direction) => turn(direction * forward),
    onToggleChrome: () => setChromeVisible((visible) => !visible),
  })

  const onPageDocument = useCallback(
    (doc: Document) => {
      docRef.current = doc
      setDocGeneration((generation) => generation + 1)
      attachPageKeys(doc)
      gestures.attachToPage(doc)
    },
    [attachPageKeys, gestures],
  )

  // Drop the previous section's document the moment the section changes, so the
  // gap before the new one loads reports no anchor rather than a wrong one — an
  // index measured against different content would resolve to the wrong screen.
  useEffect(() => {
    docRef.current = null
  }, [sectionIndex])

  useEffect(() => {
    if (!section) return
    // Child effects commit before parent ones, so the stage has already applied the
    // transform for this screen and the anchor read below reflects it.
    const doc = docRef.current
    const point = doc ? captureAnchor(doc, frame.width) : undefined
    notify.current(section.index, Math.max(screen, 0), point?.index)
  }, [section, screen, frame.width, docGeneration])

  /* ------------------------------ bookmarks ------------------------------ */

  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  useEffect(() => {
    void listBookmarks(bookId).then(setBookmarks)
  }, [bookId])

  const refresh = useCallback(async () => {
    setBookmarks(await listBookmarks(bookId))
  }, [bookId])

  /**
   * Which bookmark, if any, is on the screen being read. Resolved rather than
   * compared: the stored anchor is an element, and the screen it sits on depends
   * on the type size in force right now.
   */
  const bookmarkHere = useMemo(() => {
    const doc = docRef.current
    if (!doc || !section) return undefined
    return bookmarks.find((bookmark) => {
      if (bookmark.pageIndex !== section.index || bookmark.anchor === undefined) return false
      return screenForAnchor(doc, frame.width, bookmark.anchor) === Math.max(screen, 0)
    })
  }, [bookmarks, section, frame.width, screen, docGeneration])

  const toggleBookmark = useCallback(async () => {
    if (bookmarkHere) {
      await removeBookmark(bookmarkHere.id)
    } else {
      const doc = docRef.current
      const point = doc ? captureAnchor(doc, frame.width) : undefined
      if (!section || !point) return
      await addBookmark({
        bookId,
        pageIndex: section.index,
        anchor: point.index,
        label: `Section ${sectionIndex + 1}`,
        excerpt: point.excerpt,
      })
    }
    await refresh()
  }, [bookmarkHere, section, sectionIndex, bookId, frame.width, refresh])

  const jumpTo = useCallback(
    (bookmark: Bookmark) => {
      setMenuOpen(false)
      const target = sections.findIndex((page) => page.index === bookmark.pageIndex)
      if (target === -1 || bookmark.anchor === undefined) return

      if (target === sectionIndex) {
        const doc = docRef.current
        const resolved = doc ? screenForAnchor(doc, frame.width, bookmark.anchor) : undefined
        if (resolved !== undefined) setScreen(Math.min(resolved, screenCount - 1))
        return
      }

      // Another section: it has to be laid out before the anchor means anything.
      pendingAnchor.current = bookmark.anchor
      setSectionIndex(target)
    },
    [sections, sectionIndex, frame.width, screenCount],
  )

  /**
   * Jump to a contents entry.
   *
   * The same two cases as a bookmark: a target in the section already on screen
   * can be resolved immediately, while one in another section has to wait for that
   * section to lay out before an element has any geometry to ask about.
   */
  const jumpToNav = useCallback(
    (item: NavItem) => {
      setMenuOpen(false)
      const target = sections.findIndex((page) => page.path === item.path)
      if (target === -1) return

      if (target === sectionIndex) {
        const doc = docRef.current
        const resolved =
          doc && item.fragment ? screenForFragment(doc, frame.width, item.fragment) : 0
        setScreen(Math.min(resolved ?? 0, screenCount - 1))
        return
      }

      pendingFragment.current = item.fragment || ''
      setSectionIndex(target)
    },
    [sections, sectionIndex, frame.width, screenCount],
  )

  const set = <K extends keyof Typography>(key: K, value: Typography[K]): void =>
    setTypography((current) => ({ ...current, [key]: value }))

  return (
    // Locked means a child is holding this, so the controls that remain grow to
    // suit smaller hands — see docs/child-reading-research.md.
    <div className={`viewer viewer-reflow${locked ? ' viewer-locked' : ''}`}>
      <main className="stage" ref={stageRef} {...gestures.stageProps}>
        {section && frame.width > 0 && (
          <ReflowableStage
            key={section.index}
            bookId={bookId}
            page={section}
            frame={frame}
            typography={typography}
            screen={Math.max(screen, 0)}
            onMeasured={onMeasured}
            onDocumentReady={onPageDocument}
            resolveInline={resolveInline}
          />
        )}
      </main>

      <header className={`chrome chrome-top${chromeVisible ? '' : ' hidden'}`}>
        {locked ? (
          <span className="chrome-spacer" />
        ) : (
          <button className="icon-button" onClick={onClose} aria-label="Back to library">
            ‹ Library
          </button>
        )}
        <div className="chrome-title">
          <h1>{book.metadata.title}</h1>
          <span className="muted">
            Section {sectionIndex + 1} of {sections.length}
          </span>
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
                Text
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
          <ContentsSection items={book.nav} currentPaths={section ? [section.path] : []} onJump={jumpToNav} />
          <BookmarksSection
            bookmarks={bookmarks}
            onJump={jumpTo}
            onRemove={(bookmark) => void removeBookmark(bookmark.id).then(refresh)}
          />
          <p className="menu-note">Text size</p>
          <div className="menu-row">
            <button className="chip" onClick={() => set('fontScale', Math.max(0.8, typography.fontScale - 0.15))}>
              Smaller
            </button>
            <button className="chip" onClick={() => set('fontScale', Math.min(2.4, typography.fontScale + 0.15))}>
              Bigger
            </button>
          </div>

          <p className="menu-note">Typeface</p>
          <div className="menu-row">
            {(['publisher', 'serif', 'sans'] as ReaderFont[]).map((font) => (
              <button
                key={font}
                className={`chip${typography.font === font ? ' chip-on' : ''}`}
                onClick={() => set('font', font)}
              >
                {font === 'publisher' ? 'Book' : font === 'serif' ? 'Serif' : 'Sans'}
              </button>
            ))}
          </div>

          <p className="menu-note">Colours</p>
          <div className="menu-row">
            {(['publisher', 'paper', 'sepia', 'night'] as ReaderTheme[]).map((theme) => (
              <button
                key={theme}
                className={`chip${typography.theme === theme ? ' chip-on' : ''}`}
                onClick={() => set('theme', theme)}
              >
                {theme === 'publisher' ? 'Book' : theme === 'paper' ? 'Paper' : theme === 'sepia' ? 'Sepia' : 'Night'}
              </button>
            ))}
          </div>

          <p className="menu-note">Line spacing</p>
          <div className="menu-row">
            {([1.4, 1.6, 1.9] as const).map((value) => (
              <button
                key={value}
                className={`chip${typography.lineHeight === value ? ' chip-on' : ''}`}
                onClick={() => set('lineHeight', value)}
              >
                {value === 1.4 ? 'Tight' : value === 1.6 ? 'Normal' : 'Loose'}
              </button>
            ))}
          </div>

          <p className="menu-note">Letter spacing</p>
          <div className="menu-row">
            {/* Both settings move together under one control: the reading studies
                widened letters and words at the same time, and asking a parent to
                tune two typographic measurements separately is asking the wrong
                person the wrong question. */}
            {([0, 0.06, 0.12] as const).map((value) => (
              <button
                key={value}
                className={`chip${typography.letterSpacing === value ? ' chip-on' : ''}`}
                onClick={() => {
                  set('letterSpacing', value)
                  setTypography((current) => ({ ...current, wordSpacing: value * 1.5 }))
                }}
              >
                {value === 0 ? 'Normal' : value === 0.06 ? 'Wider' : 'Widest'}
              </button>
            ))}
          </div>
          <p className="menu-hint">
            Extra space between letters helps some children read more accurately.
          </p>
        </div>
      )}

      <footer className={`chrome chrome-bottom${chromeVisible ? '' : ' hidden'}`}>
        <button
          className="icon-button"
          onClick={() => turn(-forward)}
          disabled={sectionIndex === 0 && screen <= 0}
        >
          Previous
        </button>
        <span className="muted">
          {Math.max(screen, 0) + 1} / {screenCount}
        </span>
        <button
          className="icon-button"
          onClick={() => turn(forward)}
          disabled={sectionIndex >= sections.length - 1 && screen >= screenCount - 1}
        >
          Next
        </button>
      </footer>
    </div>
  )
}
