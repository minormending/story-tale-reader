/**
 * Preferences that belong to the reader rather than to any one book.
 *
 * Everything the reader could adjust until now — type size, spacing, narration
 * speed, whether pages turn themselves — lived in component state and was gone
 * the moment a book closed. That is a poor fit for this audience: the spacing a
 * dyslexic child reads best at, or the fact that a grown-up reads along, is a
 * standing fact about the household, not a per-session whim. Re-setting it every
 * bedtime is exactly the friction that stops a setting being used at all.
 *
 * Kept apart from LayoutOverrides, which is per-book and about a book's own
 * quirks — a mispaired spread belongs to the file, a reading mode belongs to
 * whoever is holding the tablet.
 */

import { get, put, STORE_SETTINGS } from './idb'
import { asReadingMode, DEFAULT_READING_MODE, type ReadingMode } from '../reader/readingMode'
import {
  asHighlightStrength,
  DEFAULT_HIGHLIGHT,
  type HighlightStrength,
} from '../reader/highlight'
import { asRate, asTypography, DEFAULT_TYPOGRAPHY, type Typography } from '../reader/typography'

export interface ReaderSettings {
  readingMode: ReadingMode
  /** Size, typeface, colours and spacing for reflowable books. */
  typography: Typography
  /** Narration speed. */
  rate: number
  highlight: HighlightStrength
}

export const DEFAULT_SETTINGS: ReaderSettings = {
  readingMode: DEFAULT_READING_MODE,
  typography: DEFAULT_TYPOGRAPHY,
  rate: 1,
  highlight: DEFAULT_HIGHLIGHT,
}

/** One row; there is only ever one reader's worth of preferences on a device. */
const SETTINGS_ID = 'reader'

interface StoredSettings extends Partial<ReaderSettings> {
  id: string
}

/**
 * Never throws.
 *
 * A reader that will not open a book because a preference could not be read is
 * worse than one that opens it the default way, and on the cheap tablets this
 * targets (SPEC.md §9.3) storage is genuinely allowed to be unavailable — a
 * private window, a cleared profile, a quota refusal.
 */
export async function loadSettings(): Promise<ReaderSettings> {
  try {
    const stored = await get<StoredSettings>(STORE_SETTINGS, SETTINGS_ID)
    // Field by field, so one unreadable preference does not cost the reader the
    // others -- the spacing a child reads best at should survive a renamed theme.
    return {
      readingMode: asReadingMode(stored?.readingMode),
      typography: asTypography(stored?.typography),
      rate: asRate(stored?.rate),
      highlight: asHighlightStrength(stored?.highlight),
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

/** Also never throws: failing to remember a choice must not interrupt reading. */
export async function saveSettings(settings: ReaderSettings): Promise<void> {
  try {
    await put<StoredSettings>(STORE_SETTINGS, { id: SETTINGS_ID, ...settings })
  } catch {
    // The choice still applies to this session; it just will not outlive it.
  }
}
