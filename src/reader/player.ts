/**
 * Read-along playback (SPEC.md §7.2).
 *
 * Highlighting is driven by polling `audio.currentTime` on every animation frame,
 * not by the `timeupdate` event. `timeupdate` fires roughly every 250ms, and the
 * shortest word in the reference book is 62ms — event-driven highlighting would
 * skip words outright.
 *
 * Plain TypeScript with no React: the state machine here is fiddly enough to be
 * worth keeping separate from rendering.
 */

import type { ZipArchive } from '../engine/zip/reader'
import { mimeTypeFor } from '../engine/path'
import { fragmentAt, parseSmil, DEFAULT_ACTIVE_CLASS, type OverlayFragment } from '../engine/overlays/smil'
import type { BookPage, ParsedBook } from '../engine/types'

/** Consecutive fragments that share one audio file. */
interface Segment {
  audioPath: string
  fragments: OverlayFragment[]
}

export interface PlayerCallbacks {
  onStateChange: (playing: boolean) => void
  /** Fired when the current spread's narration finishes. */
  onFinished: () => void
}

const FALLBACK_HIGHLIGHT_ID = 'story-tale-highlight-fallback'

export class ReadAlongPlayer {
  private readonly audio = new Audio()
  private readonly overlays = new Map<number, OverlayFragment[]>()
  private readonly audioUrls = new Map<string, Promise<string>>()
  private readonly documents = new Map<number, Document>()
  private readonly pageByPath = new Map<string, number>()

  private segments: Segment[] = []
  private segmentIndex = 0
  private activeFragment = -1
  private activeElement: HTMLElement | null = null
  private frame = 0
  private playing = false
  private generation = 0

  readonly activeClass: string

  constructor(
    private readonly archive: ZipArchive,
    book: ParsedBook,
    private readonly callbacks: PlayerCallbacks,
  ) {
    this.activeClass = book.activeClass || DEFAULT_ACTIVE_CLASS
    this.audio.preload = 'auto'
    for (const page of book.pages) this.pageByPath.set(page.path, page.index)
    this.audio.addEventListener('ended', () => this.onSegmentEnded())
  }

  get isPlaying(): boolean {
    return this.playing
  }

  set rate(value: number) {
    this.audio.playbackRate = value
    // Keep the narrator's voice natural at 0.75x and 1.25x.
    this.audio.preservesPitch = true
  }

  /** Register a page's iframe document so its words can be highlighted and tapped. */
  registerDocument(pageIndex: number, doc: Document): void {
    this.documents.set(pageIndex, doc)
    this.ensureHighlightStyle(doc)
    doc.addEventListener('click', this.onDocumentClick)
  }

  unregisterDocument(pageIndex: number): void {
    const doc = this.documents.get(pageIndex)
    if (doc) doc.removeEventListener('click', this.onDocumentClick)
    this.documents.delete(pageIndex)
  }

  /** Point the player at the pages currently on screen, in reading order. */
  async setPages(pages: BookPage[]): Promise<boolean> {
    const generation = ++this.generation
    this.clearHighlight()

    const fragments: OverlayFragment[] = []
    for (const page of pages) {
      for (const fragment of await this.overlayFor(page)) fragments.push(fragment)
    }
    if (generation !== this.generation) return this.segments.length > 0

    this.segments = groupByAudio(fragments)
    this.segmentIndex = 0
    this.activeFragment = -1
    return this.segments.length > 0
  }

  async play(): Promise<void> {
    if (this.segments.length === 0) return
    const segment = this.segments[this.segmentIndex]
    if (!segment) return

    await this.loadSegment(segment)
    if (this.audio.currentTime < segment.fragments[0]!.start || this.audio.currentTime >= endOf(segment)) {
      this.audio.currentTime = segment.fragments[0]!.start
    }
    try {
      await this.audio.play()
    } catch {
      // Autoplay policy, or the element was torn down mid-await.
      return
    }
    this.setPlaying(true)
    this.tick()
  }

  pause(): void {
    this.audio.pause()
    this.setPlaying(false)
    if (this.frame) cancelAnimationFrame(this.frame)
    this.frame = 0
  }

  async toggle(): Promise<void> {
    if (this.playing) this.pause()
    else await this.play()
  }

  /** Jump to the word a reader tapped, and keep going from there. */
  async seekToFragment(pageIndex: number, elementId: string): Promise<void> {
    for (let s = 0; s < this.segments.length; s++) {
      const segment = this.segments[s]!
      const index = segment.fragments.findIndex(
        (fragment) =>
          fragment.fragment === elementId && this.pageByPath.get(fragment.textPath) === pageIndex,
      )
      if (index === -1) continue

      this.segmentIndex = s
      await this.loadSegment(segment)
      this.audio.currentTime = segment.fragments[index]!.start
      this.activeFragment = -1
      if (!this.playing) await this.play()
      else this.tick()
      return
    }
  }

  destroy(): void {
    this.pause()
    this.clearHighlight()
    for (const pageIndex of [...this.documents.keys()]) this.unregisterDocument(pageIndex)
    this.audio.src = ''
    for (const url of this.audioUrls.values()) void url.then(URL.revokeObjectURL).catch(() => {})
    this.audioUrls.clear()
  }

  /* ------------------------------- internals ------------------------------- */

  private setPlaying(value: boolean): void {
    if (this.playing === value) return
    this.playing = value
    this.callbacks.onStateChange(value)
  }

  private tick = (): void => {
    const segment = this.segments[this.segmentIndex]
    if (!segment) return

    const time = this.audio.currentTime
    const index = fragmentAt(segment.fragments, time)

    if (index !== this.activeFragment) {
      this.activeFragment = index
      this.highlight(index === -1 ? undefined : segment.fragments[index])
    }

    if (time >= endOf(segment) - 0.005) {
      this.onSegmentEnded()
      return
    }

    if (this.playing) this.frame = requestAnimationFrame(this.tick)
  }

  private onSegmentEnded(): void {
    if (this.frame) cancelAnimationFrame(this.frame)
    this.frame = 0

    if (this.segmentIndex < this.segments.length - 1) {
      this.segmentIndex += 1
      this.activeFragment = -1
      void this.play()
      return
    }

    this.audio.pause()
    this.setPlaying(false)
    this.clearHighlight()
    this.callbacks.onFinished()
  }

  private async loadSegment(segment: Segment): Promise<void> {
    const url = await this.audioUrl(segment.audioPath)
    if (this.audio.src !== url) {
      this.audio.src = url
      await new Promise<void>((resolve) => {
        const done = (): void => {
          this.audio.removeEventListener('loadedmetadata', done)
          this.audio.removeEventListener('error', done)
          resolve()
        }
        this.audio.addEventListener('loadedmetadata', done)
        this.audio.addEventListener('error', done)
      })
    }
  }

  private audioUrl(path: string): Promise<string> {
    let url = this.audioUrls.get(path)
    if (!url) {
      // A blob URL rather than the virtual filesystem: media elements seek by byte
      // range constantly, and a blob is served by the browser without a round trip
      // through the service worker for every range request.
      url = this.archive.read(path).then((bytes) =>
        URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: mimeTypeFor(path) })),
      )
      this.audioUrls.set(path, url)
    }
    return url
  }

  private async overlayFor(page: BookPage): Promise<OverlayFragment[]> {
    if (!page.overlayPath) return []
    const cached = this.overlays.get(page.index)
    if (cached) return cached
    try {
      const fragments = parseSmil(await this.archive.readText(page.overlayPath), page.overlayPath)
      this.overlays.set(page.index, fragments)
      return fragments
    } catch {
      this.overlays.set(page.index, [])
      return []
    }
  }

  private highlight(fragment: OverlayFragment | undefined): void {
    this.clearHighlight()
    if (!fragment) return

    const pageIndex = this.pageByPath.get(fragment.textPath)
    if (pageIndex === undefined) return
    const doc = this.documents.get(pageIndex)
    if (!doc) return

    const element = doc.getElementById(fragment.fragment)
    if (!element) return
    element.classList.add(this.activeClass)
    this.activeElement = element
  }

  private clearHighlight(): void {
    this.activeElement?.classList.remove(this.activeClass)
    this.activeElement = null
  }

  private onDocumentClick = (event: Event): void => {
    const target = event.target as HTMLElement | null
    const doc = target?.ownerDocument
    if (!target || !doc) return

    let pageIndex: number | undefined
    for (const [index, candidate] of this.documents) {
      if (candidate === doc) pageIndex = index
    }
    if (pageIndex === undefined) return

    const element = target.closest('[id]')
    if (!element?.id) return
    void this.seekToFragment(pageIndex, element.id)
  }

  /**
   * Books normally style the active class themselves — the reference book turns the
   * spoken word red in its own stylesheet, so we add and remove *its* class and let
   * it decide. Only inject a highlight when the book defines none.
   */
  private ensureHighlightStyle(doc: Document): void {
    if (doc.getElementById(FALLBACK_HIGHLIGHT_ID)) return
    if (definesClass(doc, this.activeClass)) return

    const style = doc.createElement('style')
    style.id = FALLBACK_HIGHLIGHT_ID
    style.textContent = `.${CSS.escape(this.activeClass)} {
      background: rgba(255, 180, 84, 0.45);
      border-radius: 0.2em;
    }`
    ;(doc.head ?? doc.documentElement).appendChild(style)
  }
}

function groupByAudio(fragments: OverlayFragment[]): Segment[] {
  const segments: Segment[] = []
  for (const fragment of fragments) {
    const last = segments[segments.length - 1]
    if (last && last.audioPath === fragment.audioPath) last.fragments.push(fragment)
    else segments.push({ audioPath: fragment.audioPath, fragments: [fragment] })
  }
  return segments
}

function endOf(segment: Segment): number {
  return segment.fragments[segment.fragments.length - 1]?.end ?? 0
}

function definesClass(doc: Document, className: string): boolean {
  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) {
        const selector = (rule as CSSStyleRule).selectorText
        if (selector?.includes(className)) return true
      }
    } catch {
      // A stylesheet we cannot read; assume it does not define the class.
    }
  }
  return false
}
