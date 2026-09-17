import { useEffect, useRef, useState } from 'react'
import { BuildTag } from './BuildTag'
import type { LibraryEntry } from '../store/library'
import { storageEstimate } from '../store/files'

interface CorpusBook {
  name: string
  url: string
  size: number
}

const SAMPLE = {
  path: 'sample/peter-rabbit.epub',
  title: 'The Tale of Peter Rabbit',
  credit: 'Beatrix Potter, 1902 \u00b7 public domain',
}

export function Library({
  entries,
  onOpenFile,
  onOpenEntry,
  onDelete,
  busy,
  error,
  notice,
}: {
  entries: LibraryEntry[]
  onOpenFile: (file: File) => void
  onOpenEntry: (id: string) => void
  onDelete: (id: string) => void
  busy: string | null
  error: string | null
  notice: string | null
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const take = (files: FileList | null): void => {
    for (const file of Array.from(files ?? [])) onOpenFile(file)
  }

  return (
    <div
      className="library"
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        take(event.dataTransfer.files)
      }}
    >
      <header className="library-head">
        <div>
          <h1>Story Tale Reader</h1>
          <p className="lede">
            Picture books the way they were drawn &mdash; words on the illustration,
            spreads kept together.
          </p>
        </div>
        <button className="primary" onClick={() => inputRef.current?.click()} disabled={!!busy}>
          {busy ? 'Opening…' : 'Add a book'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".epub,.pdf,.mobi,.azw3,.prc,application/epub+zip,application/pdf"
          multiple
          hidden
          onChange={(event) => {
            take(event.target.files)
            event.target.value = ''
          }}
        />
      </header>

      {error && <p className="banner banner-error">{error}</p>}
      {notice && <p className="banner banner-warn">{notice}</p>}
      {busy && <p className="banner banner-busy">{busy}</p>}

      <main className="library-main">
      {entries.length === 0 ? (
        <div className={`dropzone${dragging ? ' dropzone-active' : ''}`}>
          <p className="dropzone-title">Your shelf is empty</p>
          <p className="muted">Drop a book here, or use &ldquo;Add a book&rdquo;.</p>
          <Sample onOpenFile={onOpenFile} busy={busy} />
        </div>
      ) : (
        <ul className={`shelf${dragging ? ' shelf-dragging' : ''}`}>
          {entries.map((entry) => (
            <li key={entry.id} className="shelf-item">
              <button className="shelf-open" onClick={() => onOpenEntry(entry.id)}>
                <Cover entry={entry} />
                <span className="shelf-title">{entry.title}</span>
                {entry.creator && <span className="shelf-author muted">{entry.creator}</span>}
                <span className="shelf-badges">
                  {entry.layout === 'pre-paginated' && <span className="badge">Fixed layout</span>}
                  {entry.hasMediaOverlays && <span className="badge badge-accent">Read-along</span>}
                </span>
              </button>
              {confirmDelete === entry.id ? (
                <div className="shelf-confirm">
                  <button
                    className="shelf-remove danger"
                    onClick={() => {
                      onDelete(entry.id)
                      setConfirmDelete(null)
                    }}
                  >
                    Remove
                  </button>
                  <button className="shelf-remove" onClick={() => setConfirmDelete(null)}>
                    Keep
                  </button>
                </div>
              ) : (
                <button
                  className="shelf-remove"
                  onClick={() => setConfirmDelete(entry.id)}
                  aria-label={`Remove ${entry.title}`}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {entries.length > 0 && !entries.some((entry) => entry.title === SAMPLE.title) && (
        <Sample onOpenFile={onOpenFile} busy={busy} inline />
      )}
      </main>

      <DevCorpus onOpenFile={onOpenFile} />

      <footer className="fineprint">
        <p>
          Nothing leaves this device. No accounts, no tracking, no network. Encrypted
          (DRM-protected) books can&rsquo;t be opened.
        </p>
        <StorageLine />
        <div className="build-row">
          <span className="muted">Version</span>
          <BuildTag />
        </div>
      </footer>
    </div>
  )
}

function Cover({ entry }: { entry: LibraryEntry }) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!entry.cover) return
    const objectUrl = URL.createObjectURL(entry.cover)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [entry.cover])

  if (!url) return <span className="shelf-cover shelf-cover-blank">{entry.title.slice(0, 1)}</span>
  return <img className="shelf-cover" src={url} alt="" loading="lazy" />
}

function StorageLine() {
  const [text, setText] = useState('')
  useEffect(() => {
    void storageEstimate().then((estimate) => {
      if (!estimate?.quota) return
      const used = estimate.usage / 1024 / 1024
      const quota = estimate.quota / 1024 / 1024 / 1024
      setText(`${used.toFixed(0)} MB used of about ${quota.toFixed(1)} GB available`)
    })
  }, [])
  return text ? <p className="muted storage-line">{text}</p> : null
}

/**
 * Shortcut for opening books from `corpus/` without a file picker, used by the dev
 * server and `vite preview`. The endpoint only exists behind the Vite plugin, so a
 * deployed static build never renders this.
 */
function DevCorpus({ onOpenFile }: { onOpenFile: (file: File) => void }) {
  const [books, setBooks] = useState<CorpusBook[]>([])

  useEffect(() => {
    // Only when the dev-corpus plugin is serving — see scripts/dev-corpus.ts.
    if (!(window as { __STORY_TALE_CORPUS__?: boolean }).__STORY_TALE_CORPUS__) return
    void fetch('/corpus/index.json')
      .then((response) => (response.ok ? response.json() : []))
      .then(setBooks)
      .catch(() => setBooks([]))
  }, [])

  if (books.length === 0) return null

  return (
    <div className="dev-corpus">
      <p className="muted">Development corpus</p>
      <div className="menu-row">
        {books.map((book) => (
          <button
            key={book.url}
            className="chip"
            onClick={() => {
              void fetch(book.url)
                .then((response) => response.blob())
                .then((blob) => onOpenFile(new File([blob], book.name)))
            }}
          >
            {book.name.replace(/\.[^.]+$/, '')}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * One-tap import of the bundled public-domain picture book, so a first-time visitor
 * can see what the reader actually does without having to find an EPUB first.
 */
function Sample({
  onOpenFile,
  busy,
  inline,
}: {
  onOpenFile: (file: File) => void
  busy: string | null
  inline?: boolean
}) {
  const [failed, setFailed] = useState(false)
  if (failed) return null

  const open = (): void => {
    void fetch(`${import.meta.env.BASE_URL}${SAMPLE.path}`)
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status))
        return response.blob()
      })
      .then((blob) => onOpenFile(new File([blob], 'peter-rabbit.epub')))
      .catch(() => setFailed(true))
  }

  return (
    <div className={inline ? 'sample sample-inline' : 'sample'}>
      <button className={inline ? 'chip' : 'primary'} onClick={open} disabled={!!busy}>
        Read the sample book
      </button>
      <span className="muted sample-credit">
        {SAMPLE.title} &mdash; {SAMPLE.credit}
      </span>
    </div>
  )
}
