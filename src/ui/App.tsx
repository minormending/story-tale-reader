import { useCallback, useEffect, useState } from 'react'
import { Library } from './Library'
import { LoadingBook, type BookLoading } from './LoadingBook'
import { canPickFolderNatively, pickFolder, type BookSource } from '../native/folderPicker'
import { Viewer } from './Viewer'
import { ReflowableViewer } from './ReflowableViewer'
import { DrmError } from '../engine/epub/ocf'
import { mountBook, setReading, startVfs, unmountBook } from '../vfs/client'
import { onBookOpened, takeIncomingBook } from '../native/bookIntent'
import {
  deleteBook, getOverrides, getProgress, importBook, listLibrary, openStoredBook,
  saveOverrides, saveProgress, type LibraryEntry, type OpenedBook,
} from '../store/library'
import type { ZipArchive } from '../engine/zip/reader'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { LayoutOverrides, ParsedBook } from '../engine/types'
import { loadSettings, saveSettings, type ReaderSettings } from '../store/settings'

interface Session {
  bookId: string
  book: ParsedBook
  archive?: ZipArchive
  pdf?: PDFDocumentProxy
  entry: LibraryEntry
  initialPageIndex: number
  initialScreen: number
  initialAnchor?: number
}

export function App() {
  const [entries, setEntries] = useState<LibraryEntry[]>([])
  const [session, setSession] = useState<Session | null>(null)
  const [overrides, setOverrides] = useState<LayoutOverrides>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [loading, setLoading] = useState<BookLoading | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  /*
   * How this household reads, loaded once and owned above both viewers.
   *
   * Above them on purpose. These are the reader's preferences, not the book's, so
   * they outlive a book being closed -- and loading them here means they are in
   * hand before any book can be opened, since the shelf has to be looked at first.
   * Loading inside the viewer instead made the stored value race the first spread,
   * which for the reading mode decides whether a book starts talking and for
   * typography decides how many screens a chapter measures to.
   *
   * `null` means "not read back yet", and the viewers treat it as "do nothing
   * irreversible" rather than substituting a default.
   */
  const [settings, setSettings] = useState<ReaderSettings | null>(null)

  useEffect(() => {
    let cancelled = false
    void loadSettings().then((stored) => {
      if (!cancelled) setSettings(stored)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const changeSettings = useCallback((patch: Partial<ReaderSettings>) => {
    setSettings((current) => {
      if (!current) return current
      const next = { ...current, ...patch }
      void saveSettings(next)
      return next
    })
  }, [])

  useEffect(() => {
    // Best effort: without it, pages are inlined instead of served (SPEC.md §9.3).
    void startVfs()
    void listLibrary().then(setEntries)
  }, [])

  // Defer any service-worker update reload until the reader leaves the book.
  useEffect(() => {
    setReading(session !== null)
  }, [session])

  const enter = useCallback(async (opened: OpenedBook) => {
    const { entry, book, archive } = opened
    setNotice(
      opened.persisted === false
        ? 'This book is open, but there wasn\u2019t room to keep it on your shelf. Free up some space and add it again.'
        : null,
    )
    // Only EPUBs are served through the virtual filesystem; a PDF is held in memory
    // by pdf.js and a MOBI is unpacked into a synthetic container.
    if (archive) mountBook(entry.id, archive)
    const [storedOverrides, position] = await Promise.all([
      getOverrides(entry.id),
      getProgress(entry.id),
    ])
    setOverrides(storedOverrides)
    setSession((previous) => {
      if (previous && previous.bookId !== entry.id) unmountBook(previous.bookId)
      return {
        bookId: entry.id,
        book,
        archive,
        entry,
        pdf: opened.pdf,
        initialPageIndex: position.pageIndex,
        initialScreen: position.screen,
        initialAnchor: position.anchor,
      }
    })
    setEntries(await listLibrary())
  }, [])

  const describe = (cause: unknown): string =>
    cause instanceof DrmError
      ? cause.message
      : `Couldn’t open this book: ${cause instanceof Error ? cause.message : String(cause)}`

  const openFile = useCallback(
    async (file: File) => {
      setError(null)
      setBusy(`Opening ${file.name}…`)
      setLoading({ title: file.name, progress: { stage: 'reading' } })
      try {
        await enter(await importBook(file, (progress) => setLoading((at) => at && { ...at, progress })))
      } catch (cause) {
        setError(describe(cause))
      } finally {
        setBusy(null)
        setLoading(null)
      }
    },
    [enter],
  )

  /**
   * Add many books at once, without opening any of them.
   *
   * Opening is the wrong ending for a folder: the reader asked for a shelf, not for
   * the last book in the list. One failure does not stop the rest either — a folder
   * of forty books will usually contain something that is not a book, or is
   * encrypted, and refusing the whole import over one file would be useless.
   */
  const importMany = useCallback(
    async (sources: BookSource[]) => {
      setError(null)
      setNotice(null)
      const failures: string[] = []

      for (const [index, source] of sources.entries()) {
        setBusy(`Adding ${index + 1} of ${sources.length}…`)
        setLoading({
          title: source.name,
          progress: { stage: 'reading' },
          batch: { done: index, total: sources.length },
        })
        try {
          // Fetched here rather than up front: on Android the bytes come across the
          // bridge one book at a time, and holding a whole folder in memory at once
          // is what kills a cheap tablet.
          const file = await source.load()
          // Nothing here is about to be rendered, so the pages need not be measured:
          // the entry only wants a title, an author, a count and a cover. Whichever
          // of these the reader opens first will measure it then, and keep it.
          await importBook(file, (progress) => setLoading((at) => at && { ...at, progress }), {
            measure: false,
          })
        } catch (cause) {
          failures.push(`${source.name}: ${cause instanceof Error ? cause.message : String(cause)}`)
        }
      }

      setBusy(null)
      setLoading(null)
      setEntries(await listLibrary())

      const added = sources.length - failures.length
      if (failures.length === 0) {
        setNotice(`Added ${added} ${added === 1 ? 'book' : 'books'}.`)
      } else {
        // Named, not counted: "3 books could not be added" leaves the reader to work
        // out which, from a shelf they have not seen before.
        setNotice(
          `Added ${added} of ${sources.length}. These could not be opened — ` +
            failures.join('; '),
        )
      }
    },
    [],
  )

  /** Android only: choose a real folder, then import what is in it. */
  const importFolder = useCallback(async () => {
    setError(null)
    const sources = await pickFolder().catch((cause) => {
      setError(cause instanceof Error ? cause.message : String(cause))
      return undefined
    })
    // Backed out of the picker, or the platform has no picker to back out of.
    if (!sources) return
    if (sources.length === 0) {
      setNotice('No books in that folder.')
      return
    }
    await importMany(sources)
  }, [importMany])

  const openEntry = useCallback(
    async (id: string) => {
      setError(null)
      setBusy('Opening…')
      // The title is already known for a book on the shelf, so the card can name it
      // straight away rather than waiting for the file to be parsed.
      const known = entries.find((entry) => entry.id === id)
      setLoading({ title: known?.title ?? 'Opening', progress: { stage: 'reading' } })
      try {
        await enter(await openStoredBook(id, (progress) => setLoading((at) => at && { ...at, progress })))
      } catch (cause) {
        setError(describe(cause))
      } finally {
        setBusy(null)
        setLoading(null)
      }
    },
    [enter, entries],
  )

  // Android: a book handed to us by a file manager or the share sheet, both at
  // cold start and while the app is already running.
  useEffect(() => {
    let handle: { remove: () => Promise<void> } | undefined
    const collect = async (): Promise<void> => {
      let file: File | undefined
      try {
        file = await takeIncomingBook()
      } catch (cause) {
        // Say why, rather than opening to an unchanged shelf as if nothing was asked.
        setError(cause instanceof Error ? cause.message : String(cause))
        return
      }
      if (file) await openFile(file)
    }
    void collect()
    void onBookOpened(() => void collect()).then((registered) => {
      handle = registered
    })
    return () => {
      void handle?.remove()
    }
  }, [openFile])

  const close = useCallback(() => {
    setSession((previous) => {
      if (previous) unmountBook(previous.bookId)
      return null
    })
    void listLibrary().then(setEntries)
  }, [])

  const changeOverrides = useCallback(
    (next: LayoutOverrides) => {
      setOverrides(next)
      if (session) void saveOverrides(session.bookId, next)
    },
    [session],
  )

  const remove = useCallback(async (id: string) => {
    await deleteBook(id)
    setEntries(await listLibrary())
  }, [])

  if (session) {
    // A book's layout decides which renderer it gets; the override lets the reader
    // correct a book whose metadata lies.
    const layout = overrides.forceLayout ?? session.book.layout
    if (layout === 'reflowable') {
      return (
        <ReflowableViewer
          bookId={session.bookId}
          book={session.book}
          settings={settings}
          onSettingsChange={changeSettings}
          archive={session.archive}
          initialPageIndex={session.initialPageIndex}
          initialScreen={session.initialScreen}
          initialAnchor={session.initialAnchor}
          onPositionChange={(pageIndex, screen, anchor) =>
            void saveProgress(session.bookId, pageIndex, screen, anchor)
          }
          onClose={close}
        />
      )
    }
    return (
      <Viewer
        bookId={session.bookId}
        book={session.book}
        settings={settings}
        onSettingsChange={changeSettings}
        archive={session.archive}
        pdf={session.pdf}
        initialPageIndex={session.initialPageIndex}
        overrides={overrides}
        onOverridesChange={changeOverrides}
        onPageIndexChange={(pageIndex) => void saveProgress(session.bookId, pageIndex)}
        onClose={close}
      />
    )
  }

  return (
    <>
      {loading && <LoadingBook loading={loading} />}
      <Library
      entries={entries}
      onOpenFile={(file) => void openFile(file)}
      onImportMany={(sources) => void importMany(sources)}
      onPickFolder={canPickFolderNatively() ? () => void importFolder() : undefined}
      onOpenEntry={(id) => void openEntry(id)}
      onDelete={(id) => void remove(id)}
      busy={busy}
      error={error}
      notice={notice}
      />
    </>
  )
}
