import type { NavItem } from '../engine/types'

interface Row {
  item: NavItem
  depth: number
}

/**
 * The book's own table of contents, flattened for rendering.
 *
 * Nesting is kept as an indent rather than as nested lists. A picture book's
 * contents is two levels at most, and a nested `<ul>` inside a menu that is itself
 * inside a reading frame gives a screen reader more structure to walk than the
 * content justifies.
 */
function flatten(items: NavItem[], depth = 0): Row[] {
  return items.flatMap((item) => [{ item, depth }, ...flatten(item.children, depth + 1)])
}

/**
 * Chapter navigation, inside the reader's menu.
 *
 * Every format arrives here the same way: EPUB parses its nav document or NCX,
 * MOBI synthesises one while unpacking, and PDF reads its outline through pdf.js.
 * A book that carries no contents at all renders nothing rather than an empty
 * heading — most picture books have no chapters to list.
 */
export function ContentsSection({
  items,
  currentPaths,
  onJump,
}: {
  items: NavItem[]
  /**
   * Paths of the documents on screen, so the reader can see where they are. A
   * plural, because a fixed-layout spread shows two pages at once and an entry
   * pointing at either of them is pointing at what is in front of the reader.
   */
  currentPaths?: readonly string[]
  onJump: (item: NavItem) => void
}) {
  if (items.length === 0) return null
  const rows = flatten(items)

  return (
    <>
      <p className="menu-note">Contents</p>
      <ul className="contents-list">
        {rows.map(({ item, depth }, i) => {
          // Path alone, not href: two entries can point at different fragments of
          // the same document, and both are "here" while it is the one on screen.
          const here = currentPaths?.includes(item.path) ?? false
          return (
            <li key={`${item.path}#${item.fragment}-${i}`}>
              <button
                className={`contents-jump${here ? ' contents-here' : ''}`}
                style={{ paddingLeft: `${0.6 + depth * 0.9}rem` }}
                aria-current={here ? 'true' : undefined}
                onClick={() => onJump(item)}
              >
                {item.label}
              </button>
            </li>
          )
        })}
      </ul>
    </>
  )
}
