import { useEffect, useMemo, useRef, useState } from 'react'
import { BuildTag } from './BuildTag'
import { canPickDirectory, filesFromDrop, isBookFile } from './pickFiles'
import type { BookSource } from '../native/folderPicker'
import { arrangeShelf, groupChoices } from './shelfGroups'
import { onBackButton } from '../native/backButton'
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
  onPickFolder,
  onAddFromDownloads,
  onSetGroup,
  onRenameGroup,
  busy,
  error,
  notice,
}: {
  entries: LibraryEntry[]
  onOpenFile: (file: File) => void
  onOpenEntry: (id: string) => void
  onDelete: (id: string) => void
  onImportMany: (sources: BookSource[]) => void
  /** Android only: a real folder chooser, which the browser cannot offer. */
  onPickFolder?: () => void
  /** Android 11 and later, where the folder picker refuses Downloads itself. */
  onAddFromDownloads?: () => void
  /** A group's name, `null` for "in no group", or `undefined` to let the shelf decide. */
  onSetGroup: (ids: string[], group: string | null | undefined) => void
  onRenameGroup: (from: string, to: string) => void
  busy: string | null
  error: string | null
  notice: string | null
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const folderRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  // Asked once: it cannot change while the page is open, and asking per render
  // would mean building a throwaway input on every keystroke in the search box.
  const [foldersWork] = useState(canPickDirectory)
  const [sort, setSort] = useState<ShelfSort>('recent')
  // Choosing books to group several at once, and which of them are chosen.
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // The books a group is being chosen for, when the group picker is open.
  const [picking, setPicking] = useState<string[] | null>(null)

  // Groups are worked out from the shelf rather than stored as groups: the reader's
  // own are a name on each book, and series are found afresh, so adding the second
  // book of a pair groups the first one too, with no re-import. Worked out from what
  // is *shown*, so a search that matches one book of three dissolves a series rather
  // than claiming a series of one (shelfGroups.ts).
  const { groups, loose, byId, shown } = useMemo(() => {
    const visible = sortShelf(
      entries.filter((entry) => matchesQuery(entry, query)),
      sort,
    )
    return {
      ...arrangeShelf(visible),
      byId: new Map(entries.map((entry) => [entry.id, entry])),
      shown: visible.length,
    }
  }, [entries, query, sort])

  const toggle = (id: string): void =>
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const stopSelecting = (): void => {
    setSelecting(false)
    setSelected(new Set())
  }

  // Android's back button closes the group picker, then leaves choosing books; with
  // neither open it falls through, and the app goes to the background.
  useEffect(
    () =>
      onBackButton(() => {
        if (picking) setPicking(null)
        else if (selecting) {
          setSelecting(false)
          setSelected(new Set())
        } else return false
        return true
      }),
    [picking, selecting],
  )

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
    // Already in hand, so each "source" simply hands its file back. The indirection
    // is for Android, where the bytes are fetched one book at a time.
    else onImportMany(books.map((file) => ({ name: file.name, load: async () => file })))
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
            {busy ? 'Opening…' : <><span aria-hidden="true">＋</span> Add a book</>}
          </button>
          <button
            className="secondary"
            // Three ways down, in order of how much they give the reader: a real
            // folder through Android's own picker, a folder through the browser, or
            // — where neither exists — several files at once, named honestly,
            // because a button that opens the wrong dialog reads as a broken app
            // rather than as a missing platform feature.
            onClick={() => {
              if (onPickFolder) onPickFolder()
              else (foldersWork ? folderRef : inputRef).current?.click()
            }}
            disabled={!!busy}
            title={
              onPickFolder || foldersWork
                ? 'Add every book in a folder'
                : 'Choose several books at once — this device cannot pick a whole folder'
            }
          >
            <span aria-hidden="true">🗂</span>{' '}
            {onPickFolder || foldersWork ? 'Add a folder' : 'Add several'}
          </button>
          {onAddFromDownloads && (
            <button
              className="secondary"
              onClick={onAddFromDownloads}
              disabled={!!busy}
              title="Add every book in Downloads, including the folders inside it"
            >
              <span aria-hidden="true">📥</span> Add from Downloads
            </button>
          )}
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
        {foldersWork && (
          <input
            ref={folderRef}
            type="file"
            // Not in the HTML standard, but the only thing the engines that support
            // directory picking agree on. React needs it lowercase in JSX.
            {...{ webkitdirectory: '' }}
            multiple
            hidden
            onChange={(event) => {
              take(Array.from(event.target.files ?? []))
              event.target.value = ''
            }}
          />
        )}
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
            placeholder="Search by title, author, series or group"
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
          <button
            className={`secondary shelf-select${selecting ? ' shelf-select-on' : ''}`}
            aria-pressed={selecting}
            onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
          >
            {selecting ? 'Done' : 'Select'}
          </button>
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
                  {group.books.length} {group.books.length === 1 ? 'book' : 'books'}
                  {/* Said plainly, because a guess the reader cannot see is a guess
                      they cannot correct. */}
                  {group.source === 'inferred' && ' · grouped by title'}
                </span>
                {group.source === 'manual' && !selecting && (
                  <span className="series-actions">
                    <button
                      className="shelf-remove"
                      onClick={() => {
                        const name = window.prompt('Rename this group', group.name)
                        if (name && name.trim()) onRenameGroup(group.name, name)
                      }}
                    >
                      Rename
                    </button>
                    <button
                      className="shelf-remove"
                      onClick={() => {
                        const ok = window.confirm(
                          `Ungroup \u201c${group.name}\u201d? Its books stay on the shelf, where the shelf would put them.`,
                        )
                        if (ok) onSetGroup(group.books.map((book) => book.id), undefined)
                      }}
                    >
                      Ungroup
                    </button>
                  </span>
                )}
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
                      selecting={selecting}
                      selected={selected.has(entry.id)}
                      onToggle={toggle}
                      onGroup={(id) => setPicking([id])}
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
                    selecting={selecting}
                    selected={selected.has(entry.id)}
                    onToggle={toggle}
                    onGroup={(id) => setPicking([id])}
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

      {selecting && (
        <div className="selection-bar" role="region" aria-label="Chosen books">
          <span className="selection-count">
            {selected.size === 0 ? 'Tap books to choose them' : `${selected.size} chosen`}
          </span>
          <button className="primary" disabled={selected.size === 0} onClick={() => setPicking([...selected])}>
            Add to a group
          </button>
          <button className="secondary" onClick={stopSelecting}>
            Done
          </button>
        </div>
      )}

      {picking && (
        <GroupPicker
          books={picking.map((id) => byId.get(id)).filter((entry): entry is LibraryEntry => !!entry)}
          choices={groupChoices(entries)}
          onChoose={(group) => {
            onSetGroup(picking, group)
            setPicking(null)
            stopSelecting()
          }}
          onClose={() => setPicking(null)}
        />
      )}

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

/**
 * Which of the six friendly colours a coverless book gets.
 *
 * Derived from the title so it never changes between sessions: a child who cannot
 * read the spine yet can still be looking for "the orange one", and that only works
 * if it is orange every time.
 */
function hueFor(title: string): number {
  let sum = 0
  for (let i = 0; i < title.length; i++) sum = (sum + title.charCodeAt(i)) % 3600
  return (sum % 6) + 1
}

function Cover({ entry }: { entry: LibraryEntry }) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!entry.cover) return
    const objectUrl = URL.createObjectURL(entry.cover)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [entry.cover])

  if (!url) {
    return (
      <span className="shelf-cover shelf-cover-blank" data-hue={hueFor(entry.title)}>
        {entry.title.slice(0, 1)}
      </span>
    )
  }
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
  selecting,
  selected,
  onToggle,
  onGroup,
}: {
  entry: LibraryEntry
  onOpenEntry: (id: string) => void
  onDelete: (id: string) => void
  confirmDelete: string | null
  setConfirmDelete: (id: string | null) => void
  /** Choosing books to group: a tap chooses a book instead of opening it. */
  selecting: boolean
  selected: boolean
  onToggle: (id: string) => void
  onGroup: (id: string) => void
}) {
  return (
    <li className={`shelf-item${selected ? ' shelf-item-selected' : ''}`}>
      <button
        className="shelf-open"
        onClick={() => (selecting ? onToggle(entry.id) : onOpenEntry(entry.id))}
        aria-pressed={selecting ? selected : undefined}
      >
        <span className="shelf-cover-frame">
          <Cover entry={entry} />
          {selecting && (
            <span className={`shelf-check${selected ? ' shelf-check-on' : ''}`} aria-hidden="true">
              {selected ? '\u2713' : ''}
            </span>
          )}
        </span>
        <span className="shelf-title">{entry.title}</span>
        {entry.creator && <span className="shelf-author muted">{entry.creator}</span>}
        <span className="shelf-badges">
          {entry.layout === 'pre-paginated' && <span className="badge">Fixed layout</span>}
          {entry.hasMediaOverlays && <span className="badge badge-accent">Read-along</span>}
        </span>
      </button>
      {selecting ? null : confirmDelete === entry.id ? (
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
        <div className="shelf-confirm">
          <button className="shelf-remove" onClick={() => onGroup(entry.id)} aria-label={`Group ${entry.title}`}>
            Group
          </button>
          <button
            className="shelf-remove"
            onClick={() => setConfirmDelete(entry.id)}
            aria-label={`Remove ${entry.title}`}
          >
            Remove
          </button>
        </div>
      )}
    </li>
  )
}

/**
 * Choosing a group for one book or several.
 *
 * Every group on the shelf is offered — the reader's own and the series the shelf
 * found, since joining a series is just joining a group of its name — along with a
 * new one, "no group", and handing the choice back to the shelf.
 */
function GroupPicker({
  books,
  choices,
  onChoose,
  onClose,
}: {
  books: LibraryEntry[]
  choices: Array<{ name: string; count: number; source: 'manual' | 'declared' | 'inferred' }>
  onChoose: (group: string | null | undefined) => void
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)
  const single = books.length === 1 ? books[0] : undefined
  const current = single?.shelfGroup
  const placedByReader = books.some((book) => book.shelfGroup !== undefined)

  useEffect(() => {
    // Focus the dialog, not the text box: on a tablet a focused text box opens the
    // keyboard over the very list of groups the reader came to choose from.
    dialogRef.current?.focus()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const title = single ? `Group \u201c${single.title}\u201d` : `Group ${books.length} books`

  return (
    <div className="picker-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className="picker-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="picker-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="picker-title" className="picker-title">{title}</h2>

        {choices.length > 0 && (
          <ul className="picker-list">
            {choices.map((choice) => {
              const isCurrent = typeof current === 'string' && current.trim().toLowerCase() === choice.name.toLowerCase()
              return (
                <li key={`${choice.source}-${choice.name}`}>
                  <button
                    className={`picker-option${isCurrent ? ' picker-option-current' : ''}`}
                    aria-current={isCurrent ? 'true' : undefined}
                    onClick={() => onChoose(choice.name)}
                  >
                    <span className="picker-option-name">{choice.name}</span>
                    <span className="muted picker-option-count">
                      {choice.count} {choice.count === 1 ? 'book' : 'books'}
                      {choice.source === 'manual' ? '' : ' \u00b7 series'}
                      {isCurrent ? ' \u00b7 in it now' : ''}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        <form
          className="picker-new"
          onSubmit={(event) => {
            event.preventDefault()
            if (name.trim()) onChoose(name)
          }}
        >
          <input
            className="shelf-search picker-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="New group name"
            aria-label="New group name"
            maxLength={80}
          />
          <button className="primary" type="submit" disabled={!name.trim()}>
            Create
          </button>
        </form>

        <div className="picker-footer">
          <button className="secondary" onClick={() => onChoose(null)} disabled={current === null}>
            In no group
          </button>
          {placedByReader && (
            <button className="secondary" onClick={() => onChoose(undefined)}>
              Let the shelf decide
            </button>
          )}
          <button className="shelf-remove picker-cancel" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
