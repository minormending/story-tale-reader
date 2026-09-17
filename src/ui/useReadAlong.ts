import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ReadAlongPlayer } from '../reader/player'
import type { ZipArchive } from '../engine/zip/reader'
import type { BookPage, Direction, ParsedBook, Spread } from '../engine/types'

export interface ReadAlongSettings {
  rate: number
  autoAdvance: boolean
}

export interface ReadAlong {
  /** True when the pages currently on screen carry narration. */
  available: boolean
  playing: boolean
  toggle: () => void
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
}: {
  book: ParsedBook
  archive: ZipArchive | undefined
  spread: Spread | undefined
  direction: Direction
  settings: ReadAlongSettings
  onFinishedSpread: () => void
}): ReadAlong {
  const [playing, setPlaying] = useState(false)
  const [available, setAvailable] = useState(false)
  const playerRef = useRef<ReadAlongPlayer | null>(null)

  const finished = useRef(onFinishedSpread)
  finished.current = onFinishedSpread

  const autoAdvance = useRef(settings.autoAdvance)
  autoAdvance.current = settings.autoAdvance

  useEffect(() => {
    if (!archive || !book.hasMediaOverlays) return
    const player = new ReadAlongPlayer(archive, book, {
      onStateChange: setPlaying,
      onFinished: () => {
        if (autoAdvance.current) finished.current()
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
    const wasPlaying = player.isPlaying
    player.pause()
    void player.setPages(pages).then((hasNarration) => {
      if (cancelled) return
      setAvailable(hasNarration)
      if (hasNarration && wasPlaying) void player.play()
    })
    return () => {
      cancelled = true
    }
  }, [pages])

  const onPageReady = useCallback((doc: Document, page: BookPage) => {
    playerRef.current?.registerDocument(page.index, doc)
  }, [])

  const toggle = useCallback(() => {
    void playerRef.current?.toggle()
  }, [])

  const stop = useCallback(() => {
    playerRef.current?.pause()
  }, [])

  const claimsTap = useCallback(
    (target: EventTarget | null) => playerRef.current?.claimsTap(target) ?? false,
    [],
  )

  return { available, playing, toggle, stop, onPageReady, claimsTap }
}
