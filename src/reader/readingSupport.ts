/**
 * Telling a grown-up what a book will and will not do for their child.
 *
 * EPUB has carried accessibility metadata for years and almost no reader shows it,
 * so the information exists and reaches nobody. The question it answers — "will
 * this book work for my child?" — is one a parent has to ask *before* settling
 * down to read, and the alternative to answering it is finding out on page one.
 *
 * Two sources, deliberately not merged into one voice:
 *
 *   - What the book *claims*, from `schema:*` in the OPF.
 *   - What the pages *show*, from counting text alternatives on the images.
 *
 * They are kept apart because they disagree. A book may declare `alternativeText`
 * and carry none; far more often it describes its pictures and declares nothing,
 * because the metadata is newer than the book. Presenting a claim as a finding
 * would make this reader a worse source than no information at all.
 */

import type { AltTextEvidence } from '../engine/epub/altText'
import type { BookAccessibility } from '../engine/types'

export type { AltTextEvidence }

export type SupportTone = 'yes' | 'no' | 'claim'

export interface SupportNote {
  tone: SupportTone
  text: string
}

/**
 * A feature name as the vocabulary spells it, mapped to something sayable.
 *
 * Only the ones that change how a book is read at this age. The vocabulary has
 * dozens more — index navigation, MathML, chemical notation — that mean nothing
 * for a picture book and would bury the two lines that matter.
 */
const FEATURE_WORDS: Record<string, string> = {
  alternativeText: 'describes its pictures',
  longDescription: 'describes its pictures at length',
  synchronizedAudioText: 'highlights the words as they are read',
  audioDescription: 'has audio description',
  displayTransformability: 'lets its text be resized and respaced',
  printPageNumbers: 'keeps the printed page numbers',
  readingOrder: 'has a reliable reading order',
  tableOfContents: 'has a table of contents',
  structuralNavigation: 'can be navigated by structure',
  captions: 'has captions',
  signLanguage: 'has sign language',
  highContrastDisplay: 'offers a high-contrast presentation',
}

/** Hazards are worth saying plainly; a child with photosensitive epilepsy is the case. */
const HAZARD_WORDS: Record<string, string> = {
  flashing: 'flashing images',
  sound: 'sudden sound',
  motionSimulation: 'simulated motion',
}

/**
 * What the pages themselves show about the pictures.
 *
 * Returns nothing rather than a reassurance when there is nothing to report: a
 * book of pure text has no pictures to describe, and announcing that it passed a
 * check it was never subject to is noise.
 */
export function describePictures(
  evidence: AltTextEvidence,
  fixedLayout: boolean,
): SupportNote | undefined {
  const { images, described, decorative, pagesChecked, pageCount } = evidence
  if (pagesChecked === 0) return undefined

  const scope = pagesChecked >= pageCount ? '' : ` in the first ${pagesChecked} pages`
  const meaningful = images - decorative

  if (meaningful === 0) {
    /*
     * Every picture is marked decorative — `alt=""`, which says "nothing here
     * worth reading out".
     *
     * In a reflowable book that is ordinarily true and not worth a line: rules,
     * flourishes, a publisher's colophon. In a fixed-layout book it is the
     * illustration saying it of itself, and since the illustration *is* the page,
     * a grown-up deciding whether this book will work should be told. It is also
     * the most common shape of the problem, so staying silent would hide the
     * usual case rather than the rare one.
     */
    if (fixedLayout && decorative > 0) {
      return { tone: 'no', text: `The pictures are marked as decoration${scope}, so they are not described.` }
    }
    return undefined
  }

  if (described === 0) {
    return { tone: 'no', text: `The pictures are not described${scope}.` }
  }
  if (described >= meaningful) {
    return { tone: 'yes', text: `Every picture is described${scope}.` }
  }
  return {
    tone: 'no',
    text: `${described} of ${meaningful} pictures are described${scope}.`,
  }
}

/**
 * Everything worth saying, in the order it is worth saying it.
 *
 * Narration first because it is the reason to choose this reader; the pictures
 * next because that is the gap; the publisher's claims last, marked as claims.
 */
export function describeReadingSupport({
  accessibility,
  pictures,
  hasMediaOverlays,
}: {
  accessibility: BookAccessibility | undefined
  pictures: SupportNote | undefined
  hasMediaOverlays: boolean
}): SupportNote[] {
  const notes: SupportNote[] = []

  // Observed, not claimed: the overlays were parsed to get here.
  notes.push(
    hasMediaOverlays
      ? { tone: 'yes', text: 'Narrated, with the words highlighted as they are read.' }
      : { tone: 'no', text: 'No narration. The words are not read aloud.' },
  )

  if (pictures) notes.push(pictures)

  for (const hazard of accessibility?.hazards ?? []) {
    const word = HAZARD_WORDS[hazard]
    if (word) notes.push({ tone: 'no', text: `The publisher warns of ${word}.` })
  }

  const claimed = (accessibility?.features ?? [])
    .map((feature) => FEATURE_WORDS[feature])
    .filter((word): word is string => !!word)
    // Narration and pictures are already reported from evidence above; repeating
    // them as claims invites the reader to weigh a promise against a measurement.
    .filter((word) => !word.startsWith('describes') && !word.startsWith('highlights'))

  if (claimed.length > 0) {
    notes.push({ tone: 'claim', text: `The publisher says it ${joinWords(claimed)}.` })
  }

  return notes
}

function joinWords(parts: string[]): string {
  if (parts.length === 1) return parts[0]!
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}
