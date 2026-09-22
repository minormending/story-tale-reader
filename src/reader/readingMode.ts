/**
 * The three ways a narrated picture book actually gets used.
 *
 * The reader already had the machinery for all three — narration, auto-advance,
 * tap-a-word — but it was spelled as one checkbox labelled "Turn the page
 * automatically", which describes a mechanism rather than a way of reading. A
 * grown-up deciding how tonight's story goes is not thinking about page turns.
 *
 * Naming them is the point. The meta-analyses behind docs/child-reading-research.md
 * put the largest effect on the adult who reads *with* the child, larger than any
 * enhancement measured inside a digital book — and nothing in this interface had
 * ever invited that. "Read together" is that invitation, and it costs one setting.
 */

export type ReadingMode = 'to-me' | 'together' | 'myself'

export const READING_MODES: readonly ReadingMode[] = ['to-me', 'together', 'myself']

/** What each mode is called, and the promise it makes to the person choosing it. */
export const MODE_LABELS: Record<ReadingMode, { name: string; hint: string }> = {
  'to-me': {
    name: 'Read to me',
    hint: 'The book reads itself and turns its own pages.',
  },
  together: {
    name: 'Read together',
    hint: 'The book reads each page, then waits for you to turn it.',
  },
  myself: {
    name: 'Read myself',
    hint: 'Quiet until asked. Tap any word to hear it.',
  },
}

export interface ModeBehaviour {
  /** Narration turns the page itself when it reaches the end of a spread. */
  autoAdvance: boolean
  /** Narration starts on its own once a spread is ready, without asking. */
  narrates: boolean
  /**
   * Bring the chrome back when narration stops with the page still on screen.
   *
   * Only "Read together" wants this, and it is the whole difference between that
   * mode and a renamed checkbox: narration ends, and the control that turns the
   * page is already to hand instead of behind a tap on a hidden bar. The chrome
   * hides itself after three seconds (SPEC.md §6.2), so by the time a grown-up
   * has finished talking about the picture it is reliably gone.
   */
  revealOnFinish: boolean
}

const BEHAVIOUR: Record<ReadingMode, ModeBehaviour> = {
  'to-me': { autoAdvance: true, narrates: true, revealOnFinish: false },
  together: { autoAdvance: false, narrates: true, revealOnFinish: true },
  myself: { autoAdvance: false, narrates: false, revealOnFinish: false },
}

export function behaviourFor(mode: ReadingMode): ModeBehaviour {
  return BEHAVIOUR[mode] ?? BEHAVIOUR['to-me']
}

/**
 * "Read to me" is the default because it is the one mode that works with nobody
 * else in the room, and a book opened by a child who cannot yet read has to do
 * something. It is also what the reader did before modes existed, so an update
 * does not change how a familiar book behaves.
 */
export const DEFAULT_READING_MODE: ReadingMode = 'to-me'

/** Narrow whatever came back out of storage; an unknown string is not a mode. */
export function asReadingMode(value: unknown): ReadingMode {
  return READING_MODES.includes(value as ReadingMode) ? (value as ReadingMode) : DEFAULT_READING_MODE
}
