import { sortWords, type TappedWord } from '../reader/wordList'

/**
 * The words tapped during the story, offered once it is over.
 *
 * Shown in the reading menu and only on the last spread, which is a deliberate
 * pair of restrictions. The evidence on in-story dictionaries is that they cost
 * comprehension while helping vocabulary (docs/child-reading-research.md), so the
 * timing is the feature: a list that can be reached mid-story is the thing the
 * research warns about, and one that appears over the final illustration is a
 * panel covering the book — which is the opposite of what this reader is for.
 *
 * Tapping a word goes back to the page it was met on and says it again. That is
 * the whole interaction; there is no definition, because this reader has no
 * dictionary and inventing one would be guessing at what a publisher meant.
 */
export function WordListSection({
  words,
  onJump,
  onForget,
}: {
  words: TappedWord[]
  onJump: (word: TappedWord) => void
  onForget: () => void
}) {
  if (words.length === 0) return null
  const ordered = sortWords(words)

  return (
    <>
      <hr className="menu-rule" />
      <p className="menu-note">Words you asked about</p>
      <ul className="word-list">
        {ordered.map((word) => (
          <li key={word.key}>
            <button className="word" onClick={() => onJump(word)}>
              <span className="word-text">{word.text}</span>
              {/* A count only once it means something. "1" beside every word is
                  noise; "3" is the difference between misheard and hard. */}
              {word.taps > 1 && (
                <span className="word-taps" aria-label={`asked ${word.taps} times`}>
                  {word.taps}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      <p className="menu-hint">Tap a word to go back and hear it again.</p>
      <button className="menu-item" onClick={onForget}>
        <span>Start the list again</span>
      </button>
    </>
  )
}
