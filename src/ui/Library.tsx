import { useEffect, useMemo, useRef, useState } from 'react'
import { BuildTag } from './BuildTag'
import { filesFromDrop, isBookFile } from './pickFiles'
import { groupIntoSeries } from '../engine/series'
import { SORT_LABELS, matchesQuery, sortShelf, type ShelfSort } from './shelf'
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
  onImportMany,
  busy,
  error,
  notice,
}: {
  entries: LibraryEntry[]
  onOpenFile: (file: File) => void
  onOpenEntry: (id: string) => void
  onDelete: (id: string) => void
  onImportMany: (files: File[]) => void
  busy: string | null
  error: string | null
  notice: string | null
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const folderRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<ShelfSort>('recent')

  // Series are worked out from the shelf rather than stored, so adding the second
  // book of a pair groups the first one too, with no re-import.
  const { groups, loose, byId, shown } = useMemo(() => {
    const visible = sortShelf(
      entries.filter((entry) => matchesQuery(entry, query)),
      sort,
    )

    const found = groupIntoSeries(
      visible.map((entry) => ({
        id: entry.id,
        title: entry.title,
        creator: entry.creator,
        series: entry.series,
        seriesIndex: entry.seriesIndex,
      })),
    )

    // Series are grouped from what is *shown*, so a search that matches one book of
    // three dissolves the group rather than claiming a series of one.
    const grouped = new Set(found.flatMap((group) => group.books.map((book) => book.id)))
    const place = new Map(visible.map((entry, index) => [entry.id, index]))

    // The sort orders the shelf; grouping is a view over it. A group sits where its
    // best-placed member would have sat, and keeps its own order inside, because
    // reading a series out of sequence is not an order anybody asked for.
    const ordered = [...found].sort(
      (a, b) =>
        Math.min(...a.books.map((x) => place.get(x.id) ?? Infinity)) -
        Math.min(...b.books.map((x) => place.get(x.id) ?? Infinity)),
    )

    return {
      groups: ordered,
      loose: visible.filter((entry) => !grouped.has(entry.id)),
      byId: new Map(entries.map((entry) => [entry.id, entry])),
      shown: visible.length,
    }
  }, [entries, query, sort])

  /**
   * One book opens; several are added to the shelf.
   *
   * Opening every file in a multi-selection was what this did before, which meant
   * each one replaced the last and the reader landed in whichever happened to be
   * final. Picking several books is a request for a shelf, not for a race.
   */
  const take = (files: File[]): void => {
    const books = files.filter(isBookFile)
    if (books.length === 0) return
    if (books.length === 1 && books[0]) onOpenFile(books[0])
    else onImportMany(books)
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
        // Read the entries before awaiting: the transfer's item list is emptied as
        // soon as this handler returns, so a dropped folder has to be walked from a
        // snapshot taken now.
        void filesFromDrop(event.dataTransfer).then(take)
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
        <div className="library-actions">
          <button className="primary" onClick={() => inputRef.current?.click()} disabled={!!busy}>
            {busy ? 'Opening…' : 'Add a book'}
          </button>
          <button
            className="secondary"
            onClick={() => folderRef.current?.click()}
            disabled={!!busy}
            title="Add every book in a folder"
          >
            Add a folder
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".epub,.pdf,.mobi,.azw3,.prc,application/epub+zip,application/pdf"
          multiple
          hidden
          onChange={(event) => {
            take(Array.from(event.target.files ?? []))
            event.target.value = ''
          }}
        />
        <input
          ref={folderRef}
          type="file"
          // Not in the HTML standard, but the only thing every engine agrees on for
          // picking a directory. React needs it lowercase in JSX.
          {...{ webkitdirectory: '' }}
          multiple
          hidden
          onChange={(event) => {
            take(Array.from(event.target.files ?? []))
            event.target.value = ''
          }}
        />
      </header>

      {error && <p className="banner banner-error">{error}</p>}
      {notice && <p className="banner banner-warn">{notice}</p>}

      {/* Only worth the room once there is enough on the shelf to lose a book in. */}
      {entries.length > 4 && (
        <div className="shelf-controls">
          <input
            className="shelf-search"
            type="search"
            value={query}
            // Named by the attribute rather than by a visually hidden label. The
            // hidden-label trick is a line of text in a one-pixel box, which is a
            // container clipping its own content — indistinguishable, to anything
            // measuring the page, from text a reader was meant to see and cannot.
            aria-label="Search your books"
            placeholder="Search by title, author or series"
            onChange={(event) => setQuery(event.target.value)}
          />
          <label className="shelf-sort">
            <span className="muted">Sort</span>
            <select value={sort} onChange={(event) => setSort(event.target.value as ShelfSort)}>
              {(Object.keys(SORT_LABELS) as ShelfSort[]).map((option) => (
                <option key={option} value={option}>
                  {SORT_LABELS[option]}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <main className="library-main">
      {entries.length > 0 && shown === 0 ? (
        <p className="shelf-empty muted">
          Nothing matches &ldquo;{query}&rdquo;.{' '}
          <button className="link-button" onClick={() => setQuery('')}>
            Show all {entries.length} books
          </button>
        </p>
      ) : entries.length === 0 ? (
        <div className={`dropzone${dragging ? ' dropzone-active' : ''}`}>
          <p className="dropzone-title">Your shelf is empty</p>
          <p className="muted">Drop a book here, or use &ldquo;Add a book&rdquo;.</p>
          <Sample onOpenFile={onOpenFile} busy={busy} />
        </div>
      ) : (
        <>
          {groups.map((group) => (
            <section className="series" key={`${group.source}-${group.name}`}>
              <h2 className="series-name">
                {group.name}
                <span className="muted series-count">
                  {group.books.length} books
                  {/* Said plainly, because a guess the reader cannot see is a guess
                      they cannot correct. */}
                  {group.source === 'inferred' && ' · grouped by title'}
                </span>
              </h2>
              <ul className={`shelf${dragging ? ' shelf-dragging' : ''}`}>
                {group.books.map((book) => {
                  const entry = byId.get(book.id)
                  return entry ? (
                    <ShelfItem
                      key={entry.id}
                      entry={entry}
                      onOpenEntry={onOpenEntry}
                      onDelete={onDelete}
                      confirmDelete={confirmDelete}
                      setConfirmDelete={setConfirmDelete}
                    />
                  ) : null
                })}
              </ul>
            </section>
          ))}

          {loose.length > 0 && (
            <section className="series">
              {groups.length > 0 && <h2 className="series-name">Everything else</h2>}
              <ul className={`shelf${dragging ? ' shelf-dragging' : ''}`}>
                {loose.map((entry) => (
                  <ShelfItem
                    key={entry.id}
                    entry={entry}
                    onOpenEntry={onOpenEntry}
                    onDelete={onDelete}
                    confirmDelete={confirmDelete}
                    setConfirmDelete={setConfirmDelete}
                  />
                ))}
              </ul>
            </section>
          )}
        </>
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

/** One book on the shelf. Extracted so a grouped shelf and a flat one share it. */
function ShelfItem({
  entry,
  onOpenEntry,
  onDelete,
  confirmDelete,
  setConfirmDelete,
}: {
  entry: LibraryEntry
  onOpenEntry: (id: string) => void
  onDelete: (id: string) => void
  confirmDelete: string | null
  setConfirmDelete: (id: string | null) => void
}) {
  return (
    <li className="shelf-item">
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
  )
}
