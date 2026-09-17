import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ReflowableStage } from './ReflowableStage'
import { useFrameSize } from './useFrameSize'
import { usePageKeys } from './usePageKeys'
import { usePageGestures } from './usePageGestures'
import { DEFAULT_TYPOGRAPHY, type ReaderFont, type ReaderTheme, type Typography } from '../reader/typography'
import { InlinePageResolver } from '../vfs/inline'
import { isVfsReady } from '../vfs/client'
import type { ZipArchive } from '../engine/zip/reader'
import type { ParsedBook } from '../engine/types'

export interface ReflowableViewerProps {
  bookId: string
  book: ParsedBook
  archive: ZipArchive | undefined
  initialPageIndex: number
  initialScreen: number
  onPositionChange: (pageIndex: number, screen: number) => void
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
  onPositionChange,
  onClose,
}: ReflowableViewerProps) {
  const [stageRef, frame] = useFrameSize<HTMLDivElement>()
  const [chromeVisible, setChromeVisible] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
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
  useEffect(() => {
    if (section) notify.current(section.index, Math.max(screen, 0))
  }, [section, screen])

  const onMeasured = useCallback((count: number) => {
    setScreenCount(count)
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
        else onClose()
      }
    },
    [turn, forward, onClose, menuOpen],
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
      attachPageKeys(doc)
      gestures.attachToPage(doc)
    },
    [attachPageKeys, gestures],
  )

  const set = <K extends keyof Typography>(key: K, value: Typography[K]): void =>
    setTypography((current) => ({ ...current, [key]: value }))

  return (
    <div className="viewer viewer-reflow">
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
        <button className="icon-button" onClick={onClose} aria-label="Back to library">
          ‹ Library
        </button>
        <div className="chrome-title">
          <h1>{book.metadata.title}</h1>
          <span className="muted">
            Section {sectionIndex + 1} of {sections.length}
          </span>
        </div>
        <button className="icon-button" onClick={() => setMenuOpen((open) => !open)}>
          Text
        </button>
      </header>

      {menuOpen && (
        <div className="menu" role="group" aria-label="Text settings">
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
