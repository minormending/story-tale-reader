import { useCallback, useEffect, useState } from 'react'
import { Library } from './Library'
import { Viewer } from './Viewer'
import { loadEpub } from '../engine/epub/load'
import { DrmError } from '../engine/epub/ocf'
import { blobSource } from '../engine/zip/reader'
import { mountBook, startVfs, unmountBook, type VfsStatus } from '../vfs/client'
import type { LayoutOverrides, ParsedBook } from '../engine/types'

interface Session {
  bookId: string
  book: ParsedBook
}

export function App() {
  const [vfs, setVfs] = useState<VfsStatus | 'starting'>('starting')
  const [session, setSession] = useState<Session | null>(null)
  const [overrides, setOverrides] = useState<LayoutOverrides>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void startVfs().then(setVfs)
  }, [])

  const openFile = useCallback(
    async (file: File) => {
      setError(null)
      setBusy(`Opening ${file.name}…`)
      try {
        const bookId = await fingerprint(file)
        const { book, archive } = await loadEpub(blobSource(file))
        mountBook(bookId, archive)
        setOverrides({})
        setSession((previous) => {
          if (previous) unmountBook(previous.bookId)
          return { bookId, book }
        })
      } catch (cause) {
        setError(
          cause instanceof DrmError
            ? cause.message
            : `Couldn’t open this book: ${cause instanceof Error ? cause.message : String(cause)}`,
        )
      } finally {
        setBusy(null)
      }
    },
    [],
  )

  const close = useCallback(() => {
    setSession((previous) => {
      if (previous) unmountBook(previous.bookId)
      return null
    })
  }, [])

  if (session) {
    return (
      <Viewer
        bookId={session.bookId}
        book={session.book}
        overrides={overrides}
        onOverridesChange={setOverrides}
        onClose={close}
      />
    )
  }

  return (
    <Library
      onOpenFile={(file) => void openFile(file)}
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

/**
 * Stable per-book id from the file's head and size. Used as the virtual-filesystem
 * key, and in M2 as the library's identity for de-duplicating re-imports.
 */
async function fingerprint(file: File): Promise<string> {
  const head = await file.slice(0, 1024 * 1024).arrayBuffer()
  const salted = new Uint8Array(head.byteLength + 8)
  salted.set(new Uint8Array(head), 0)
  new DataView(salted.buffer).setFloat64(head.byteLength, file.size, true)
  const digest = await crypto.subtle.digest('SHA-256', salted)
  return [...new Uint8Array(digest).slice(0, 12)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
