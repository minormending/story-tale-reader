import { useCallback, useEffect, useState } from 'react'
import { Library } from './Library'
import { LoadingBook, type BookLoading } from './LoadingBook'
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
    async (files: File[]) => {
      setError(null)
      setNotice(null)
      const failures: string[] = []

      for (const [index, file] of files.entries()) {
        setBusy(`Adding ${index + 1} of ${files.length}…`)
        setLoading({
          title: file.name,
          progress: { stage: 'reading' },
          batch: { done: index, total: files.length },
        })
        try {
          // Nothing here is about to be rendered, so the pages need not be measured:
          // the entry only wants a title, an author, a count and a cover. Whichever
          // of these the reader opens first will measure it then, and keep it.
          await importBook(file, (progress) => setLoading((at) => at && { ...at, progress }), {
            measure: false,
          })
        } catch (cause) {
          failures.push(`${file.name}: ${cause instanceof Error ? cause.message : String(cause)}`)
        }
      }

      setBusy(null)
      setLoading(null)
      setEntries(await listLibrary())

      const added = files.length - failures.length
      if (failures.length === 0) {
        setNotice(`Added ${added} ${added === 1 ? 'book' : 'books'}.`)
      } else {
        // Named, not counted: "3 books could not be added" leaves the reader to work
        // out which, from a shelf they have not seen before.
        setNotice(
          `Added ${added} of ${files.length}. These could not be opened — ` +
            failures.join('; '),
        )
      }
    },
    [],
  )

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
      const file = await takeIncomingBook()
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
      onImportMany={(files) => void importMany(files)}
      onOpenEntry={(id) => void openEntry(id)}
      onDelete={(id) => void remove(id)}
      busy={busy}
      error={error}
      notice={notice}
      />
    </>
  )
}
