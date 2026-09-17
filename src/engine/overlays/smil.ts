/**
 * EPUB 3 Media Overlays (SPEC.md §7).
 *
 * A SMIL document ties fragments of a content document to clip ranges in an audio
 * file. In the reference book that mapping is per *word*, which is what makes
 * genuine read-along possible — and what almost no Android reader implements,
 * despite the timings shipping inside the book.
 */

import { parseXml, findAll, findFirst, attr } from '../xml'
import { dirname, resolvePath, splitFragment } from '../path'

export interface OverlayFragment {
  /** Container-absolute path of the content document this fragment highlights. */
  textPath: string
  /** Element id within that document. */
  fragment: string
  /** Container-absolute path of the audio file. */
  audioPath: string
  /** Seconds. */
  start: number
  end: number
}

/**
 * Parse a SMIL clock value.
 *
 * Handles the full-clock, partial-clock and timecount forms from the SMIL 3.0
 * specification: `00:02:23.297`, `02:23.297`, `23.297`, `300ms`, `12.5s`,
 * `2.5min`, `1h`, optionally prefixed with `npt=`.
 */
export function parseClockValue(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const value = raw.trim().replace(/^npt=/i, '')
  if (!value) return undefined

  const clock = /^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(value)
  if (clock) {
    const hours = clock[1] ? Number.parseInt(clock[1], 10) : 0
    const minutes = Number.parseInt(clock[2]!, 10)
    const seconds = Number.parseFloat(clock[3]!)
    return hours * 3600 + minutes * 60 + seconds
  }

  const timecount = /^(\d+(?:\.\d+)?)\s*(ms|s|min|h)?$/i.exec(value)
  if (!timecount) return undefined
  const amount = Number.parseFloat(timecount[1]!)
  if (!Number.isFinite(amount)) return undefined

  switch ((timecount[2] ?? 's').toLowerCase()) {
    case 'ms': return amount / 1000
    case 'min': return amount * 60
    case 'h': return amount * 3600
    default: return amount
  }
}

/** Fragments from one SMIL document, in document order. */
export function parseSmil(xml: string, smilPath: string): OverlayFragment[] {
  const baseDir = dirname(smilPath)
  const doc = parseXml(xml)
  const body = findFirst(doc, 'body') ?? doc

  const out: OverlayFragment[] = []
  // <par> may be nested inside any number of <seq> elements; document order is
  // playback order, so a flat descendant walk is exactly right.
  for (const par of findAll(body, 'par')) {
    const text = findFirst(par, 'text')
    const audio = findFirst(par, 'audio')
    if (!text || !audio) continue

    const textSrc = attr(text, 'src')
    const audioSrc = attr(audio, 'src')
    if (!textSrc || !audioSrc) continue

    const [textHref, fragment] = splitFragment(textSrc)
    if (!fragment) continue

    const start = parseClockValue(attr(audio, 'clipBegin')) ?? 0
    const end = parseClockValue(attr(audio, 'clipEnd'))
    if (end === undefined || end <= start) continue

    out.push({
      textPath: resolvePath(baseDir, textHref),
      fragment,
      audioPath: resolvePath(baseDir, audioSrc),
      start,
      end,
    })
  }

  return out
}

/** Default when a book omits `media:active-class`. */
export const DEFAULT_ACTIVE_CLASS = '-epub-media-overlay-active'

/**
 * Locate the fragment covering a playback time.
 *
 * Binary search, because this runs on every animation frame: the shortest word in
 * the reference book is 62ms, so highlighting has to be driven by rAF rather than
 * the `timeupdate` event, which fires only about every 250ms and would skip words
 * outright.
 */
export function fragmentAt(fragments: OverlayFragment[], time: number): number {
  let low = 0
  let high = fragments.length - 1
  let best = -1

  while (low <= high) {
    const mid = (low + high) >> 1
    const candidate = fragments[mid]!
    if (time < candidate.start) {
      high = mid - 1
    } else if (time >= candidate.end) {
      low = mid + 1
    } else {
      return mid
    }
  }

  // Between fragments (a gap in the narration): keep the one just passed, so the
  // highlight lingers on the last word instead of flickering off.
  best = high
  return best >= 0 && best < fragments.length ? best : -1
}
