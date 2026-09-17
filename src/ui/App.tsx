import { useCallback, useEffect, useState } from 'react'
import { Library } from './Library'
import { Viewer } from './Viewer'
import { ReflowableViewer } from './ReflowableViewer'
import { DrmError } from '../engine/epub/ocf'
import { mountBook, startVfs, unmountBook, type VfsStatus } from '../vfs/client'
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
}

export function App() {
  const [vfs, setVfs] = useState<VfsStatus | 'starting'>('starting')
  const [entries, setEntries] = useState<LibraryEntry[]>([])
  const [session, setSession] = useState<Session | null>(null)
  const [overrides, setOverrides] = useState<LayoutOverrides>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void startVfs().then(setVfs)
    void listLibrary().then(setEntries)
  }, [])

  const enter = useCallback(async (opened: OpenedBook) => {
    const { entry, book, archive } = opened
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
      try {
        await enter(await importBook(file))
      } catch (cause) {
        setError(describe(cause))
      } finally {
        setBusy(null)
      }
    },
    [enter],
  )

  const openEntry = useCallback(
    async (id: string) => {
      setError(null)
      setBusy('Opening…')
      try {
        await enter(await openStoredBook(id))
      } catch (cause) {
        setError(describe(cause))
      } finally {
        setBusy(null)
      }
    },
    [enter],
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
          initialPageIndex={session.initialPageIndex}
          initialScreen={session.initialScreen}
          onPositionChange={(pageIndex, screen) =>
            void saveProgress(session.bookId, pageIndex, screen)
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
    <Library
      entries={entries}
      onOpenFile={(file) => void openFile(file)}
      onOpenEntry={(id) => void openEntry(id)}
      onDelete={(id) => void remove(id)}
      busy={busy}
      error={error}
      vfsWarning={
        vfs === 'unsupported' || vfs === 'failed'
          ? 'This browser blocked the service worker, so fixed-layout books can’t be displayed. Try a normal (non-private) window.'
          : null
      }
    />
  )
}
