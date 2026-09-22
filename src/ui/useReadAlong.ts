import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ReadAlongPlayer } from '../reader/player'
import type { ZipArchive } from '../engine/zip/reader'
import type { BookPage, Direction, ParsedBook, Spread } from '../engine/types'
import { behaviourFor, type ReadingMode } from '../reader/readingMode'

export interface ReadAlongSettings {
  rate: number
  /**
   * `null` until the stored mode has been read back.
   *
   * Not a cosmetic distinction: a mode that narrates starts narrating on its own,
   * so defaulting to one while the real answer is still in flight would have a
   * book saved as "Read myself" speak the moment it opened. Unknown therefore
   * means silent, and the only cost is that narration waits for an IndexedDB read
   * that a book's own parse comfortably outlasts.
   */
  mode: ReadingMode | null
}

export interface ReadAlong {
  /** True when the pages currently on screen carry narration. */
  available: boolean
  playing: boolean
  toggle: () => void
  /** Play the spread on screen again from its first word. */
  replay: () => void
  stop: () => void
  onPageReady: (doc: Document, page: BookPage) => void
  /** True when a tap landed on a word the narration can jump to. */
  claimsTap: (target: EventTarget | null) => boolean
}

/** Pages of a spread in reading order. */
function readingOrder(spread: Spread | undefined, direction: Direction): BookPage[] {
  if (!spread) return []
  if (spread.center) return [spread.center]
  const ordered = direction === 'rtl' ? [spread.right, spread.left] : [spread.left, spread.right]
  return ordered.filter((page): page is BookPage => page !== undefined)
}

export function useReadAlong({
  book,
  archive,
  spread,
  direction,
  settings,
  onFinishedSpread,
  onWaitingForReader,
}: {
  book: ParsedBook
  archive: ZipArchive | undefined
  spread: Spread | undefined
  direction: Direction
  settings: ReadAlongSettings
  /** Turn the page. Returns whether it moved — false at the end of the book. */
  onFinishedSpread: () => boolean
  /**
   * Narration reached the end of a spread that nobody is going to turn for the
   * reader. "Read together" uses this to put the chrome back, so the control that
   * turns the page is already there when the grown-up has finished talking.
   */
  onWaitingForReader?: () => void
}): ReadAlong {
  const [playing, setPlaying] = useState(false)
  const [available, setAvailable] = useState(false)
  const playerRef = useRef<ReadAlongPlayer | null>(null)

  const finished = useRef(onFinishedSpread)
  finished.current = onFinishedSpread

  /**
   * Set when narration ran out and the page was turned for the reader, so the new
   * spread knows to keep reading.
   *
   * The player is genuinely stopped by then — it reports `isPlaying` false before
   * announcing that it finished — so the spread-change effect below could not tell
   * an auto-turn apart from the reader turning the page themselves, and stopped. A
   * read-along book that has to be restarted by hand on every spread is not one.
   */
  const keepReading = useRef(false)

  const mode = useRef(settings.mode)
  mode.current = settings.mode

  const waiting = useRef(onWaitingForReader)
  waiting.current = onWaitingForReader

  /**
   * The reader pressed pause, as opposed to narration simply running out.
   *
   * The two look identical to the player — both end with `isPlaying` false — but
   * they mean opposite things at the next page turn. A mode that narrates should
   * pick the new page up; a reader who deliberately silenced the book should not
   * have it start talking again because they turned a page.
   */
  const pausedByReader = useRef(false)

  /**
   * Whether the spread on screen is the one the book opened at.
   *
   * The difference decides whether narration may carry on by itself, and the
   * spread effect below cannot otherwise tell the two apart — mounting at spread 1
   * and arriving at spread 2 look identical to it. It stays set through a run that
   * bails for want of a player, since the next run is then still the first real
   * one.
   */
  const atOpeningSpread = useRef(true)

  useEffect(() => {
    if (!archive || !book.hasMediaOverlays) return
    const player = new ReadAlongPlayer(archive, book, {
      onStateChange: setPlaying,
      onFinished: () => {
        // A finished spread with no mode yet cannot have been started by one.
        if (!mode.current) return
        const behaviour = behaviourFor(mode.current)
        // Only claim the next spread if there actually is one; otherwise the flag
        // would survive to the reader's next page turn and start narrating
        // somewhere they never asked for.
        if (behaviour.autoAdvance) {
          keepReading.current = finished.current()
          return
        }
        if (behaviour.revealOnFinish) waiting.current?.()
      },
    })
    playerRef.current = player
    return () => {
      player.destroy()
      playerRef.current = null
      setPlaying(false)
    }
  }, [archive, book])

  useEffect(() => {
    if (playerRef.current) playerRef.current.rate = settings.rate
  }, [settings.rate])

  const pages = useMemo(() => readingOrder(spread, direction), [spread, direction])

  // Point the player at the new spread. Narration continues across a page turn when
  // it is already playing, which is what auto-advance needs to feel continuous.
  useEffect(() => {
    const player = playerRef.current
    if (!player) {
      setAvailable(false)
      return
    }
    let cancelled = false
    /*
     * Carry narration onto the new spread, unless the mode says a page turn ends
     * it — which is what separates "Read myself" from the other two.
     *
     * Only ever a continuation. Nothing here starts a silent book talking: on the
     * first spread of a freshly opened book the player is not playing and no page
     * was turned, so every clause is false and it stays quiet until someone
     * presses play. Opening a book that narrates itself was tried and is wrong —
     * it gives nobody a moment to look at the page, and with auto-advance on it
     * reads to the end whether or not anyone is listening.
     */
    const resume =
      player.isPlaying ||
      keepReading.current ||
      (!atOpeningSpread.current &&
        mode.current !== null &&
        behaviourFor(mode.current).resumesOnTurn &&
        !pausedByReader.current)
    atOpeningSpread.current = false
    keepReading.current = false
    player.pause()
    void player.setPages(pages).then((hasNarration) => {
      if (cancelled) return
      setAvailable(hasNarration)
      if (hasNarration && resume) void player.play()
    })
    return () => {
      cancelled = true
    }
  }, [pages])

  const onPageReady = useCallback((doc: Document, page: BookPage) => {
    playerRef.current?.registerDocument(page.index, doc)
  }, [])

  const toggle = useCallback(() => {
    const player = playerRef.current
    if (!player) return
    pausedByReader.current = player.isPlaying
    void player.toggle()
  }, [])

  /** Hear this spread again from the beginning. */
  const replay = useCallback(() => {
    // Asking to hear it again is asking for sound, whatever was pressed before.
    pausedByReader.current = false
    void playerRef.current?.restart()
  }, [])

  const stop = useCallback(() => {
    keepReading.current = false
    pausedByReader.current = true
    playerRef.current?.pause()
  }, [])

  const claimsTap = useCallback(
    (target: EventTarget | null) => playerRef.current?.claimsTap(target) ?? false,
    [],
  )

  return { available, playing, toggle, replay, stop, onPageReady, claimsTap }
}
