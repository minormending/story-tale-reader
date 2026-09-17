import type { Bookmark } from '../store/bookmarks'

/** One-tap add or remove for the place being read. */
export function BookmarkToggle({
  bookmarked,
  onToggle,
}: {
  bookmarked: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      className={`bookmark${bookmarked ? ' bookmark-on' : ''}`}
      aria-pressed={bookmarked}
      aria-label={bookmarked ? 'Remove this bookmark' : 'Bookmark this page'}
      title={bookmarked ? 'Remove this bookmark' : 'Bookmark this page'}
      onClick={onToggle}
    >
      {bookmarked ? '\u{1F516}' : '☆'}
    </button>
  )
}

/**
 * The saved places, inside the reader's menu.
 *
 * Deleting is a plain button rather than a swipe: a swipe on a list inside a
 * reader that already treats horizontal drags as page turns would be a trap, and
 * a bookmark is cheap enough to lose that a confirmation would be worse.
 */
export function BookmarksSection({
  bookmarks,
  onJump,
  onRemove,
}: {
  bookmarks: Bookmark[]
  onJump: (bookmark: Bookmark) => void
  onRemove: (bookmark: Bookmark) => void
}) {
  return (
    <>
      <p className="menu-note">Bookmarks</p>
      {bookmarks.length === 0 ? (
        <p className="menu-hint">
          None yet. Use the star in the toolbar to save the page you&rsquo;re on.
        </p>
      ) : (
        <ul className="bookmark-list">
          {bookmarks.map((bookmark) => (
            <li key={bookmark.id}>
              <button className="bookmark-jump" onClick={() => onJump(bookmark)}>
                <span className="bookmark-label">{bookmark.label}</span>
                {bookmark.excerpt && <span className="muted bookmark-excerpt">{bookmark.excerpt}</span>}
              </button>
              <button
                className="bookmark-remove"
                onClick={() => onRemove(bookmark)}
                aria-label={`Remove bookmark at ${bookmark.label}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <hr className="menu-rule" />
    </>
  )
}
