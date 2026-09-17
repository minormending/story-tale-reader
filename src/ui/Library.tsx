import { useEffect, useRef, useState } from 'react'

interface CorpusBook {
  name: string
  url: string
  size: number
}

export function Library({
  onOpenFile,
  busy,
  error,
  vfsWarning,
}: {
  onOpenFile: (file: File) => void
  busy: string | null
  error: string | null
  vfsWarning: string | null
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const take = (files: FileList | null): void => {
    const file = files?.[0]
    if (file) onOpenFile(file)
  }

  return (
    <div className="library">
      <header className="library-head">
        <h1>Story Tale Reader</h1>
        <p className="lede">
          Picture books the way they were drawn &mdash; words on the illustration, spreads
          kept together.
        </p>
      </header>

      {vfsWarning && <p className="banner banner-warn">{vfsWarning}</p>}
      {error && <p className="banner banner-error">{error}</p>}

      <div
        className={`dropzone${dragging ? ' dropzone-active' : ''}`}
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
        {busy ? (
          <p className="dropzone-busy">{busy}</p>
        ) : (
          <>
            <p className="dropzone-title">Open a book</p>
            <p className="muted">Drop an EPUB here, or</p>
            <button className="primary" onClick={() => inputRef.current?.click()}>
              Choose a file
            </button>
            <input
              ref={inputRef}
              type="file"
              accept=".epub,application/epub+zip"
              hidden
              onChange={(event) => {
                take(event.target.files)
                event.target.value = ''
              }}
            />
          </>
        )}
      </div>

      <DevCorpus onOpenFile={onOpenFile} />

      <p className="fineprint">
        Nothing leaves this device. No accounts, no tracking, no network. Encrypted
        (DRM-protected) books can&rsquo;t be opened.
      </p>
    </div>
  )
}

/**
 * Shortcut for opening books from `corpus/` without a file picker, used by the dev
 * server and `vite preview`. The endpoint only exists behind the Vite plugin, so a
 * deployed static build never renders this.
 */
function DevCorpus({ onOpenFile }: { onOpenFile: (file: File) => void }) {
  const [books, setBooks] = useState<CorpusBook[]>([])

  useEffect(() => {
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
