import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ReadAlongPlayer } from '../reader/player'
import type { ZipArchive } from '../engine/zip/reader'
import type { BookPage, Direction, ParsedBook, Spread } from '../engine/types'
import { behaviourFor, type ReadingMode } from '../reader/readingMode'
import type { HighlightStrength } from '../reader/highlight'

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
  /** How hard the spoken word should be to miss (SPEC.md §7.6). */
  highlight: HighlightStrength
}

export interface ReadAlong {
  /** True when the pages currently on screen carry narration. */
  available: boolean
  playing: boolean
  toggle: () => void
  /** Play the spread on screen again from its first word. */
  replay: () => void
  /**
   * Say one word again, from the word list (§7.6).
   *
   * Takes the page as well as the element because the word may be on a spread
   * that is not up yet: the caller turns to it and asks in the same breath, and
   * the request waits for the spread rather than being timed against it.
   */
  speak: (pageIndex: number, elementId: string) => void
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
  onWordTapped,
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
  /** A narrated word was tapped, for the word list offered after the book (§7.6). */
  onWordTapped?: (word: {
    text: string
    pageIndex: number
    elementId: string
    order: number
  }) => void
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

  const tapped = useRef(onWordTapped)
  tapped.current = onWordTapped

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
   * A word asked for before the spread holding it had finished mounting.
   *
   * The word list turns the page and asks in one action, so the request usually
   * arrives while the new spread's overlays are still being read. Holding it and
   * firing when the pages are ready beats guessing at a delay, which is wrong on
   * a slow tablet in exactly the direction that matters.
   */
  const pendingWord = useRef<{ pageIndex: number; elementId: string } | null>(null)

  /**
   * Whether anybody has actually started this book reading.
   *
   * Carrying narration onto a new spread is a property of reading that is already
   * under way, and this is the only thing that establishes it. The obvious test —
   * "is this the spread the book opened at?" — looked equivalent and is not: the
   * spread effect runs again whenever the spread changes for any reason, including
   * being moved to the saved reading position just after mount, and that second run
   * would read as a page turn and start a silent book talking.
   *
   * It was hidden for a while by an accident. The reading mode used to be loaded
   * inside the viewer, so it was still null for the first few renders and the
   * resume clause could not fire; moving settings above the viewer removed that
   * window and the fault appeared at once. The audit caught it both times, in the
   * same two states.
   */
  const hasPlayed = useRef(false)

  useEffect(() => {
    if (!archive || !book.hasMediaOverlays) return
    const player = new ReadAlongPlayer(archive, book, {
      onStateChange: setPlaying,
      onWordTapped: (word) => tapped.current?.(word),
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
    hasPlayed.current = false
    return () => {
      player.destroy()
      playerRef.current = null
      setPlaying(false)
    }
  }, [archive, book])

  useEffect(() => {
    if (playerRef.current) playerRef.current.rate = settings.rate
  }, [settings.rate])

  useEffect(() => {
    if (playerRef.current) playerRef.current.highlightStyle = settings.highlight
  }, [settings.highlight])

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
      (hasPlayed.current &&
        mode.current !== null &&
        behaviourFor(mode.current).resumesOnTurn &&
        !pausedByReader.current)
    keepReading.current = false
    player.pause()
    void player.setPages(pages).then((hasNarration) => {
      if (cancelled) return
      setAvailable(hasNarration)

      const wanted = pendingWord.current
      if (wanted && pages.some((page) => page.index === wanted.pageIndex)) {
        pendingWord.current = null
        hasPlayed.current = true
        void player.seekToFragment(wanted.pageIndex, wanted.elementId)
        return
      }

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
    if (!player.isPlaying) hasPlayed.current = true
    void player.toggle()
  }, [])

  /** Hear this spread again from the beginning. */
  const replay = useCallback(() => {
    // Asking to hear it again is asking for sound, whatever was pressed before.
    pausedByReader.current = false
    hasPlayed.current = true
    void playerRef.current?.restart()
  }, [])

  /** Say one word again, waiting for its spread if the page is still turning. */
  const speak = useCallback((pageIndex: number, elementId: string) => {
    const player = playerRef.current
    if (!player) return
    pausedByReader.current = false
    if (pages.some((page) => page.index === pageIndex)) {
      hasPlayed.current = true
      void player.seekToFragment(pageIndex, elementId)
      return
    }
    pendingWord.current = { pageIndex, elementId }
  }, [pages])

  const stop = useCallback(() => {
    keepReading.current = false
    pausedByReader.current = true
    playerRef.current?.pause()
  }, [])

  const claimsTap = useCallback(
    (target: EventTarget | null) => playerRef.current?.claimsTap(target) ?? false,
    [],
  )

  return { available, playing, toggle, replay, speak, stop, onPageReady, claimsTap }
}
