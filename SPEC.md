# Story Tale Reader — Technical Specification

> A fixed-layout-first ebook reader for children's picture books.
> Ships as an installable PWA on GitHub Pages **and** as a sideloadable Android APK from GitHub Releases.

App name: **Story Tale Reader** · Android id: `com.kramdath.storytalereader`
Status: **M0–M7 built** · Last updated: 2026-09-17

---

## 1. Problem statement

Every mainstream Android EPUB reader mangles children's picture books. Three failure
modes, all observed by the user, all with the same root cause:

| # | Symptom | Root cause |
|---|---------|-----------|
| **F1** | Illustration renders as one block, all the page's text dumped underneath it | The reader routes fixed-layout content through its **reflowable** pipeline: it discards the publisher stylesheet and the per-document `<meta name="viewport">`, so `position:absolute; top:…; left:…` collapses into normal flow |
| **F2** | Only one page of a two-page spread is visible at a time | The reader ignores `rendition:spread` and never synthesizes spreads in landscape |
| **F3** | Two pages *are* shown, but paired off-by-one, so art doesn't meet at the gutter and text sits on the wrong illustration | The spine carries no `page-spread-left`/`page-spread-right` properties and the reader guesses parity instead of deriving it |

**None of these are hard problems.** They are all "the reader did not implement the
EPUB 3 Fixed-Layout Documents spec." Story Tale Reader's core thesis is that a correct,
narrow implementation beats a broad, sloppy one.

### 1.1 Evidence — the reference book

`Amelia Bedelia Is for the Birds` (HarperCollins, ISBN 9780062334268) is the
canonical test case. Structure:

```
rendition:layout       pre-paginated        ← it is fixed-layout, explicitly
rendition:spread       landscape            ← pair pages when the screen is wide
rendition:orientation  auto
page viewport          800 × 1200 CSS px    ← declared in every page's <meta viewport>
images                 800 × 1199 JPG, one per page (NOT pre-composed spreads)
text                   real, selectable, absolutely positioned over the image
audio                  1 × 6m48s .m4a + 27 SMIL files with per-WORD timings
spread hints           ABSENT from the spine  ← this is what breaks F3
page-list              present, cover=1 … page032=32  ← this is how we fix F3
```

A page is simply:

```html
<!-- page012.xhtml -->
<meta name="viewport" content="width=800, height=1200" />
<div class="page012">
  <img src="images/page012.jpg" alt="Image"/>
  <div class="page012-text"><p><span id='word1'>“Oh,</span> …</p></div>
  <div class="page012a-text"><p><span id='word17'>“They</span> …</p></div>
</div>
```

```css
body           { width:800px; height:1200px; margin:0; }
body > div     { position:relative; overflow:hidden; width:800px; height:1200px; }
img            { position:absolute; height:1200px; }
p              { position:relative; font-size:38px; line-height:70px; width:800px; }
.page012-text  > p { margin-left:130px; top:80px;  }
.page012a-text > p { margin-left:130px; top:500px; }
```

The publisher hand-placed every text block onto every illustration. **If you honor
the viewport and the stylesheet, the layout is already correct — you have to do
nothing else.** F1 is caused entirely by throwing that information away.

### 1.2 What we cannot fix

If a book is authored as genuinely *reflowable* HTML — image, then paragraph, in
document order, with no positioning data — the information needed to place text on
the illustration **does not exist in the file**. No reader can recover it. Storyframe
will render such books correctly *as reflowable books* and will not pretend otherwise.
A future best-effort "overlay guess" mode is listed under non-goals.

---

## 2. Goals & non-goals

### Goals

- **G1** Pixel-correct fixed-layout EPUB 3 rendering: text on the illustration, exactly where the publisher put it.
- **G2** Correct spread synthesis in landscape, with a one-tap manual correction for books whose metadata is wrong or absent.
- **G3** Word-level read-along (EPUB 3 Media Overlays) — narration with synchronized highlighting and tap-a-word-to-seek.
- **G4** Works fully offline on a cheap Android tablet. No account, no network, no ads, no telemetry.
- **G5** One codebase → GitHub Pages PWA + signed APK on GitHub Releases.
- **G6** Child-safe operation: big targets, no accidental exits, optional lock mode.

### Non-goals (v1)

- Any DRM. Adobe ADEPT, Kindle KFX/AZW4, LCP are **explicitly out of scope**. Story Tale Reader opens files the user already has in the clear.
- Comic formats (CBZ/CBR) — plausible v2, cheap to add.
- Cloud sync, accounts, a store, reading-stats dashboards.
- Annotation/highlighting authoring (bookmarks only in v1).
- Text-to-speech synthesis. Read-along uses the publisher's *recorded* narration only.
- Heuristic "guess where the text goes" for reflowable picture books (see §1.2). Revisit after v1 with real corpus evidence.
- iOS. The architecture doesn't preclude it (Capacitor targets iOS too) but it needs a paid developer account to sideload, which defeats the distribution model.

---

## 3. Users & platforms

| Audience | Platform | Install path |
|---|---|---|
| Primary: a parent reading with a child | Android tablet, 7"–11" | APK from GitHub Releases |
| Secondary: anyone with a link | Desktop/mobile browser | GitHub Pages URL, "Install app" for offline |

**Support matrix**

- Android 6.0 / API 23+ (Capacitor 7 floor), targeting API 35.
- Chromium WebView 100+. Feature-detect and degrade: see §9.3.
- Screen sizes 600 dp – 1600 dp wide. Landscape = spread, portrait = single page.
- Desktop Chrome/Edge/Firefox/Safari current − 2.

---

## 4. Architecture

### 4.1 Repository layout

```
story-tale-reader/
├─ src/
│  ├─ engine/             # pure TypeScript, ZERO framework deps — unit-tested headlessly
│  │  ├─ zip/             # random-access zip reader (custom, fflate inflate)
│  │  ├─ epub/            # OCF -> OPF -> manifest/spine/nav parsing
│  │  ├─ layout/          # FXL detection, viewport, spread pairing  <- the fix for F2/F3
│  │  ├─ overlays/        # SMIL parsing + clock values
│  │  ├─ pdf/             # phase 3
│  │  ├─ mobi/            # phase 4
│  │  └─ types.ts
│  ├─ vfs/                # service-worker virtual filesystem client + protocol
│  ├─ store/              # OPFS + IndexedDB persistence
│  ├─ ui/                 # React: library, viewer, settings
│  └─ sw.ts               # service worker (injectManifest)
├─ android/               # Capacitor Android project
├─ corpus/
│  ├─ fixtures/           # synthetic EPUBs built by script — committed
│  └─ local/              # gitignored: real, in-copyright books for dev
├─ docs/
└─ .github/workflows/
```

> **Deviation from the original draft:** a single Vite app rather than an npm-workspace
> monorepo. The engine keeps the property that matters — no framework imports, testable
> without a browser — while avoiding workspace/Vite/Capacitor build plumbing that buys
> nothing at this size.

**Why the engine is a separate, framework-free package:** it is the part that must be
correct, and it must be testable headlessly in CI without a browser. It exposes a
`Book` object and knows nothing about React, the DOM, or Capacitor.

### 4.2 Stack

| Concern | Choice | Rationale |
|---|---|---|
| Language | TypeScript, strict | Layout math and format parsing are where bugs hide |
| Build | Vite | Fast, first-class PWA plugin, works as Capacitor's web build |
| UI | React 19 + plain CSS (custom properties) | UI is small; no need for a CSS framework |
| State | Zustand | Minimal, no boilerplate, easy to persist |
| Zip | `@zip.js/zip.js` | **Random access** over a Blob — inflate one entry on demand instead of expanding a 300 MB book into memory |
| Android shell | **Capacitor** | Chosen over TWA because TWA loads from the network and cannot reach files in `Downloads`. Capacitor bundles assets and gives real filesystem + share-target access |
| PDF (phase 3) | `pdfjs-dist` | The only serious option |
| Tests | Vitest (unit) + Playwright (visual regression) | §11 |

**Deliberately not used:** `epub.js` and `readium-js`. `epub.js` is effectively
unmaintained and its fixed-layout support is precisely the weak spot that causes
F1–F3 in the apps we're replacing. Adopting it would import the bug. `foliate-js`
is a reasonable reference implementation to read, and is a live fallback candidate
for the *reflowable* renderer in phase 2 only.

### 4.3 The critical decision: a service-worker virtual filesystem

An EPUB page references its assets with **relative URLs** (`images/page012.jpg`,
`stylesheet.css`, `fonts/FuturaStd-Bold.woff`). Two ways to make those resolve:

1. **Blob URLs + URL rewriting** — extract every asset, mint `blob:` URLs, rewrite
   every `src`/`href` in the HTML *and* every `url()` in every CSS file (including
   `@font-face`). Fragile, slow, and the resulting iframe is cross-origin, so **we
   cannot script into it** — which kills Media Overlays (§7).

2. **Service worker virtual filesystem** ✅ — register a SW that intercepts
   `/__book__/<bookId>/<path>` and serves the entry straight out of the zip with the
   right `Content-Type`.

   ```
   GET /__book__/a1b2/OEBPS/page012.xhtml  → inflate OEBPS/page012.xhtml
   GET /__book__/a1b2/OEBPS/images/page012.jpg → inflate, serve as image/jpeg
   ```

   Relative URLs then resolve **natively, with zero rewriting**. The iframe is
   same-origin, so we can inject the highlight class for read-along. Fonts, CSS,
   and audio all just work.

This works on GitHub Pages (HTTPS) and inside Capacitor (the WebView serves the app
from `https://localhost`, where service workers are available).

*Fallback:* if `navigator.serviceWorker` is unavailable, fall back to blob-URL
rewriting with read-along disabled, and surface a one-line notice. Feature-detected
at startup, not assumed.

### 4.4 Data model

```ts
interface Book {
  id: string;                       // content hash
  format: 'epub' | 'pdf' | 'mobi';
  metadata: { title: string; creator?: string; language?: string; identifier?: string };
  layout: 'pre-paginated' | 'reflowable';
  spread: 'none' | 'landscape' | 'portrait' | 'both' | 'auto';
  direction: 'ltr' | 'rtl';
  pages: Page[];
  nav: NavItem[];
  hasMediaOverlays: boolean;
}

interface Page {
  index: number;                    // spine order
  href: string;                     // path inside the container
  viewport: { width: number; height: number };   // intrinsic CSS px — §5.2
  spreadSide: 'left' | 'right' | 'center';       // resolved — §5.3
  printedPage?: string;             // from nav page-list
  overlay?: MediaOverlay;           // §7
}

interface BookOverrides {           // per-book, persisted, user-editable — §6.4
  forceLayout?: 'pre-paginated' | 'reflowable';
  spreadShift?: 0 | 1;              // the one-tap fix for F3
  spreadMode?: 'auto' | 'single' | 'double';
  viewportOverride?: { width: number; height: number };
}
```

---

## 5. The fixed-layout engine (the heart of the project)

### 5.1 Detecting fixed layout

Resolve in priority order; first hit wins.

1. Spine itemref `properties` contains `rendition:layout-pre-paginated` or `rendition:layout-reflowable` (per-page override).
2. OPF `<meta property="rendition:layout">`.
3. `META-INF/com.apple.ibooks.display-options.xml` → `<option name="fixed-layout">true</option>` (legacy; **present in the reference book**).
4. Legacy Kindle `<meta name="fixed-layout" content="true">`.
5. Heuristic: ≥80% of spine documents contain a `<meta name="viewport">` with explicit pixel `width` **and** `height`.
6. Default `reflowable`.
7. `BookOverrides.forceLayout` beats all of the above.

### 5.2 Determining the page viewport

Per spine document, in priority order:

1. OPF `<meta property="rendition:viewport">` → `width=800, height=1200`.
2. The document's own `<meta name="viewport" content="width=800, height=1200">` ← the reference book.
3. Intrinsic pixel dimensions of the document's first/largest `<img>` or root `<svg viewBox>`.
4. Fall back to the book's modal viewport across all pages.
5. Last resort 1200 × 1600, and flag the book as "layout uncertain" in the UI.

Mixed viewports within one book are legal (e.g. a 1600 × 1200 pre-composed spread
page sitting among 800 × 1200 single pages). The layout engine must handle a page
whose aspect ratio differs from its neighbours' — such a page is automatically
`spreadSide: 'center'` and occupies the full frame alone.

### 5.3 Spread pairing — the fix for F3

```
resolveSpreads(spine, nav, direction, overrides):
  # 1. Explicit wins, always
  for each itemref:
    if properties has rendition:page-spread-left   → side = left
    if properties has rendition:page-spread-right  → side = right
    if properties has rendition:page-spread-center → side = center
  if every itemref was explicit: goto APPLY

  # 2. Derive from the nav page-list  ← what the reference book needs
  if nav has a page-list mapping hrefs to printed page numbers:
    n = printed number for this href
    side = (n is even) ? left : right        # LTR; mirrored for RTL
    goto APPLY

  # 3. Derive from viewport aspect ratio
  if a page's viewport is ~2× as wide as the book's modal page:
    side = center                            # a pre-composed full spread

  # 4. Fall back to index parity, cover alone
  side = (index == 0) ? center
       : ((index - 1) is even ? left : right)

APPLY:
  if overrides.spreadShift == 1: flip every left↔right
  if direction == rtl:           mirror left↔right
  group consecutive [left, right] into spreads;
  a center, or a left/right without its partner, renders alone
```

Applied to the reference book: no explicit properties → rule 2 fires → `page-list`
gives `cover=1, titlepageleft=2, titlepageright=3, page004=4 …`. So the cover is a
solo recto, then `(2,3)`, `(4,5)`, … `(12,13)`. **The 800 × 1200 illustrations on
pages 12 and 13 meet correctly at the gutter, each with its own text on top.**

A naive index-parity reader pairs `(cover,2)`, `(3,4)`, `(5,6)` — every spread off by
one, exactly symptom F3.

**`rendition:spread` governs *whether* to pair:** `none` → never; `landscape` →
only when the frame is wider than tall (reference book); `portrait` → only when
taller; `both`/`auto` → whenever the frame is wide enough that a spread scales
larger than a single page would.

### 5.4 Rendering & scaling

Each page is **one `<iframe>` sized to its exact intrinsic viewport**, then scaled
by a CSS transform. Never resize the content; never touch the publisher's CSS.

```
frame = the area available for the spread (viewport minus chrome)
content = { w: Σ page widths + gutter, h: max page height }
scale = min(frame.w / content.w, frame.h / content.h)      # contain; never upscale past 1 unless "fill screen" is on
```

```html
<div class="page-slot" style="width: calc(800px * var(--s)); height: calc(1200px * var(--s))">
  <iframe
    src="/__book__/a1b2/OEBPS/page012.xhtml"
    sandbox="allow-same-origin"
    scrolling="no"
    style="width:800px; height:1200px; border:0;
           transform: scale(var(--s)); transform-origin: top left;"
  ></iframe>
</div>
```

Notes that matter:

- **`transform: scale()`, not `zoom`.** Transform is compositor-accelerated, keeps
  text crisp, and doesn't perturb the internal layout the way `zoom` can.
- **`sandbox="allow-same-origin"` without `allow-scripts`.** Same-origin is required
  so we can inject the read-along highlight class. Withholding `allow-scripts` means
  book-supplied JavaScript never executes — the right default for children's books
  from arbitrary sources. (Granting both together voids the sandbox entirely.)
- Inject a tiny stylesheet to disable scrolling, text selection callouts, and tap
  highlight inside the frame. Nothing else. **Never** inject anything that could
  perturb positioning.
- **Mount window:** keep current spread ± 1 mounted, recycle `<iframe>` elements
  from a pool. Page turns are then instant with no white flash.
- Wait for `img.decode()` on the visible spread before revealing, to avoid a
  text-over-empty-space flash.

### 5.5 Reflowable rendering (phase 2)

Separate, simpler path: paginate with CSS multi-column inside a scroll container,
one iframe for the whole spine item, column-width = frame width. Settings for font
size, family, line height, margins, and theme (light/sepia/dark). CFI-based position
tracking so bookmarks survive a font-size change.

---

## 6. Reader UX

### 6.1 Library

Grid of cover thumbnails (extracted at import, cached as WebP). Long-press → rename,
re-import, delete, layout overrides. Sort by recent/title/author. Import via:

- File picker (`<input type="file" multiple accept=".epub,.pdf,.mobi,.azw3">`)
- Drag & drop onto the window (desktop/web)
- Android: system share sheet + "Open with Storyframe" from any file manager

One bundled public-domain sample book ships with the app, so the GitHub Pages URL
demonstrates fixed-layout rendering to a first-time visitor instead of showing an
empty shelf. **Sourcing that sample is an open item — see §13.**

### 6.2 Viewer

- Tap left third / right third → previous / next. Tap center → toggle chrome.
- Swipe horizontally → page turn, with a short slide transition (no page-curl).
- Chrome auto-hides after 3 s: back, title, page indicator, read-along controls, menu.
- Pinch to zoom up to 4×, pan while zoomed, tap to reset. **Built**, with two
  deviations: the whole spread zooms rather than one page, so a detail crossing the
  gutter stays whole and panning works across both halves; and a *single* tap
  resets rather than a double tap, because at 1× a tap in the outer third turns the
  page — a double tap would have fired two page turns before the second tap landed.
  ctrl/cmd + wheel is the pointer-device equivalent, since a mouse cannot pinch.
  Zoom resets on a page turn, and the pan is bounded so the page cannot be flung
  off-screen.
- Rotate: portrait → single page; landscape → spread, per `rendition:spread`.
- Resume exactly where you left off, per book.

### 6.3 Child-safety

- **Lock mode**: **built.** A tap on the padlock hides the library and menu
  affordances and makes Escape a no-op, leaving everything that reads the book —
  paging, narration, zoom. Leaving takes a three-second hold, shown as a fill.
  Locking is a tap rather than the specified long-press: nothing is lost by
  locking, and the guard belongs on the direction a child must not manage by
  accident. Keyboard and assistive-technology activation toggles directly, because
  a hold cannot be expressed with a key and trapping an AT user would be worse than
  the risk it guards against. The state is per-session and is not persisted — being
  stuck locked after a reload, with no memory of having locked it, is a worse
  failure than losing the lock.
- Screen-on while reading: **built**, using the Screen Wake Lock API rather than a
  Capacitor plugin, so it works in the installed PWA as well as the APK.
- No external links, no network calls at runtime, no ads, no analytics, no accounts.

### 6.4 Per-book overrides — the pragmatic escape hatch

In the viewer menu, under "Fix layout":

| Control | Fixes |
|---|---|
| **Shift spread pairing** ⇄ | F3 on any book whose metadata is absent or wrong — instantly re-pairs every spread |
| Force single / double page | F2 when `rendition:spread` is missing or lying |
| Force fixed-layout / reflowable | Books with no layout metadata at all |
| Set page size manually | Books with a bogus or missing viewport |

Persisted per book. This matters: metadata in the wild is unreliable, and a
one-tap user correction is worth more than a cleverer heuristic.

---

## 7. Read-along / Media Overlays

The reference book carries a 6:48 `.m4a` and 27 SMIL files with **per-word**
timings — a feature essentially no Android reader implements. This is the headline
differentiator.

### 7.1 Data

Manifest item → `media-overlay="mo-page012"` → `smil/page012.smil`:

```xml
<par id="par1">
  <text src="../page012.xhtml#word1"/>
  <audio src="../audio/abforthebirds.m4a" clipBegin="00:02:23.297" clipEnd="00:02:25.523"/>
</par>
```

OPF metadata supplies `media:active-class` = `-epub-media-overlay-active`, and the
book's own stylesheet already defines `.-epub-media-overlay-active { color:#ff0000 }`.
**We do not invent a highlight style — we add and remove the publisher's class and
the book styles itself.** If a book omits `media:active-class`, fall back to an
injected default highlight.

### 7.2 Playback engine

- One `<audio>` element for the whole book (a single media file here), served from the SW VFS.
- Build a flat, sorted timeline of `{ pageIndex, elementId, start, end }`.
- **Drive highlighting from `requestAnimationFrame` polling `audio.currentTime` — not `timeupdate`.** `timeupdate` fires roughly every 250 ms; the shortest word in this book (`word12`, "a") is **62 ms** long. `timeupdate` would skip words outright.
- On each frame: binary-search the timeline for the active `par`, and if it changed, remove the active class from the previous element and add it to the new one (via the same-origin iframe's `contentDocument`).
- At a page's last `par` end: pause and hold, or auto-turn and continue, per setting.
- **Tap a word** → look up its `par` → `audio.currentTime = clipBegin` → play. This is the feature that makes kids re-listen to a word they didn't catch.
- Controls: play/pause, 0.75× / 1× / 1.25× rate (`preservesPitch = true`), auto-advance toggle, highlight on/off.

### 7.3 Clock values

SMIL clock parsing must handle `00:02:23.297`, `02:23.297`, `23.297s`, `2.5min`,
`1h`, and bare seconds. Small, fully unit-tested module.

---

## 8. Other formats

### 8.1 PDF (phase 3)

`pdfjs-dist` rendering to canvas at `devicePixelRatio`-aware scale. Reuses the
viewer shell wholesale: spreads = consecutive pages (with the same shift override),
pinch-zoom, thumbnails. Text layer for selection/search. No read-along.

### 8.2 MOBI / AZW3 (phase 4)

- Parse PalmDOC container → detect KF8 (AZW3) vs legacy MOBI 6.
- **AZW3/KF8** is structurally close to EPUB: extract to an in-memory OCF-like tree and hand it to the reflowable renderer. Fixed-layout KF8 is rare but detectable.
- **Legacy MOBI 6** is a genuinely unpleasant format (PalmDOC/HUFFCDIC compression, inline `<img recindex>`). Support it as best-effort reflowable and say so plainly in the UI.
- Any DRM'd file (`EXTH` DRM flags, `.azw`/KFX) is rejected at import with a clear message. See §12.

---

## 9. Storage, offline, and the PWA

### 9.1 Storage

| Data | Store |
|---|---|
| Book files (the original zip/pdf bytes) | **OPFS**, one file per book, with random access |
| Metadata, covers, progress, overrides, bookmarks | IndexedDB |
| App shell | Service worker precache (Workbox via `vite-plugin-pwa`) |

Books are stored verbatim — never re-encoded — so the user's file is never damaged
and re-export is trivial.

*Fallback:* where OPFS is unavailable (old WebView), store book bytes as IndexedDB
blobs. Slower for large PDFs; functionally identical for EPUBs.

### 9.2 Quota

Request persistent storage on first import (`navigator.storage.persist()`). Show
usage in Settings with per-book sizes and a delete action. Warn above 80% quota.

### 9.3 Feature detection & degradation

Checked at startup; each failure degrades one capability, never the whole app:

| Missing | Consequence |
|---|---|
| Service worker | Blob-URL fallback; read-along disabled |
| OPFS | IndexedDB blob storage |
| `AudioContext` / m4a decode | Read-along disabled, silent reading intact |
| `element.decode()` | Skip the pre-reveal decode wait |

---

## 10. Android packaging

- **Capacitor 7**, `minSdk 23`, `targetSdk 35`. The web build in `apps/reader/dist` is bundled into the APK — the app is fully functional with the device in airplane mode from first launch.
- Plugins: Filesystem, Share (receive), StatusBar, ScreenOrientation, KeepAwake.
- Intent filters for `application/epub+zip`, `application/pdf`, `application/x-mobipocket-ebook`, plus `.epub`/`.azw3` path-pattern matching, so Story Tale Reader appears in "Open with" from any file manager.
- Handle `ACTION_VIEW` / `ACTION_SEND` at cold start: copy the incoming file into app storage, import, open.
- Immersive full-screen while reading; edge-to-edge with safe-area insets honored.
- Ship a **universal APK** (not an AAB) — this is sideloaded, not Play-distributed.

---

## 11. Testing

Visual correctness is the entire product, so the test strategy is weighted toward it.

1. **Unit (Vitest)** — OPF/manifest/spine parsing, layout detection, viewport resolution, **the spread-pairing algorithm against hand-built fixtures for every metadata combination**, SMIL clock parsing, zip random access.
2. **Golden-image regression (Playwright)** — render every page of every corpus book at fixed viewports (1280×800 landscape, 800×1280 portrait) and diff against committed PNGs. This is the only thing that reliably prevents a silent return of F1. A failing diff blocks the PR.
3. **Overlay timing** — assert the correct element carries the active class at sampled timestamps, including the 62 ms word.
4. **Manual device pass** before each release on a real low-end tablet: import from Downloads, airplane-mode read, rotate mid-page, lock mode, resume after kill.

**Corpus** — committed to `corpus/`, and legally clean:
- Synthetic FXL fixtures we author, covering: no spread metadata; explicit `page-spread-*`; RTL; mixed viewports; pre-composed spread pages; missing viewport; media overlays.
- Public-domain FXL books.
- **The Amelia Bedelia file is the primary dev target but must NOT be committed** — it's in copyright. Keep it in a gitignored `corpus/local/`, and encode its *structure* as a synthetic fixture.

---

## 12. Legal & privacy

- **DRM is out of scope and will not be circumvented.** Encrypted files are detected at import and rejected with an explanation. Story Tale Reader opens files the user already possesses in the clear.
- The repository contains **no copyrighted books**. Bundled sample and corpus are public domain or authored by us. `.gitignore` covers `corpus/local/`.
- Zero telemetry, zero analytics, zero network requests after install. Worth stating in the README — it's a real selling point for a children's app.

---

## 13. Milestones

| # | Deliverable | Status |
|---|---|---|
| **M0** | Skeleton, CI, Pages deploy | ✅ |
| **M1** | **Fixed-layout EPUB reader** — *fixes F1, F2, F3* | ✅ |
| **M2** | Library, OPFS storage, covers, resume, per-book overrides | ✅ |
| **M3** | **Read-along** — SMIL, word highlighting, tap-to-seek | ✅ |
| **M4** | **APK** — Capacitor shell, intent filters, signed release workflow | ✅ built in CI |
| **M5** | Reflowable EPUB — column pagination, typography, themes | ✅ |
| **M6** | PDF via pdf.js | ✅ |
| **M7** | MOBI / AZW3 | ✅ except HUFF/CDIC |

### Known gaps

- **HUFF/CDIC-compressed MOBI** (compression type 17480) is detected and refused with
  an explanation rather than rendered as rubbish. Uncompressed and PalmDOC-compressed
  books, which includes all KF8/AZW3, work. Implementing HUFF/CDIC without a sample
  file to verify against would have meant shipping unverifiable bit-twiddling.
- **The Android intent handling has not run on a physical device.** It compiles in CI
  and the plugin is present in the APK, but "Open with" from a file manager is
  unverified until someone installs the build. Everything else is web code that has
  been exercised running.
- **Bookmarks** are still unscoped (§16.3 deferred them to M5 or later); resume
  position ships and works.
- **Pinch-zoom and lock mode are verified with a mouse and synthetic pointer
  events, not a touchscreen.** Touch differs in ways that matter here — it captures
  a pointer to its original target, and the browser arbitrates multi-touch
  differently — so the two-finger pinch path in particular is unproven on a real
  device. The wake lock could only be observed failing with `NotAllowedError: the
  requesting page is not visible`, which is the expected result for a hidden page
  and the exact case the hook re-acquires from; it has not been seen holding.
- **CFI** position tracking was specified for reflowable books (§5.5). The
  implementation stores section index plus screen index instead, which survives a
  font-size change within a section but not across one. Worth revisiting when
  bookmarks land.

---

## 14. CI/CD

| Workflow | Trigger | Does |
|---|---|---|
| `ci.yml` | PR, push | typecheck, lint, unit tests, Playwright golden-image diff |
| `pages.yml` | push to `main` | build `apps/reader`, deploy to GitHub Pages |
| `android.yml` | tag `v*` | web build → `cap sync` → Gradle `assembleRelease` → sign → attach APK to the GitHub Release |

**Signing** — generate a release keystore once, store it base64-encoded in repo
secrets (`ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
`ANDROID_KEY_PASSWORD`). Keep the same key forever: Android refuses to upgrade an
installed app signed with a different key. **Back the keystore up outside the repo —
losing it means every user must uninstall and reinstall.**

Vite `base` must be set to the repo name for Pages, and to `/` for the Capacitor
build — one env-driven config value, easy to get wrong, worth a test.

---

## 15. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| WebView on cheap tablets is old and lacks OPFS/SW | High | Feature detection + graceful degradation (§9.3); test on a real low-end device early, at M1, not at M4 |
| Spread pairing still wrong on some book | Medium | The manual shift toggle (§6.4) resolves any case in one tap — ship the escape hatch alongside the heuristic |
| Books with mixed viewports / pre-composed spreads | Medium | Explicit `center` handling in §5.2/§5.3, plus corpus fixtures |
| Books using scripted FXL (rare) | Low | `allow-scripts` withheld by default; add a per-book opt-in if a real case appears |
| Memory on large PDFs | Medium | Random-access zip + page recycling; cap the mount window |
| iframe scaling blurs text on some WebViews | Low | Golden-image tests catch it; fall back to re-rendering at device scale if needed |
| Keystore loss | High | Documented backup procedure in `docs/release.md` |

---

## 16. Open questions & resolutions

1. ~~**Sample book**~~ **Resolved: *The Tale of Peter Rabbit*** (Beatrix Potter, 1902), built by `npm run sample` from Project Gutenberg ebook 14838 and committed at `public/sample/peter-rabbit.epub` (1.6MB, 30 pages). Public domain worldwide — published 1902, and Potter died in 1943, so it cleared life+70 in 2014. All Project Gutenberg branding is stripped, so none of their trademark terms apply. Gutenberg ships it *reflowable* (image, then text beneath), which is the exact shape this reader exists to improve on; the sample re-lays it out fixed-layout with the text positioned on each page, and deliberately carries no `page-spread-*` properties so it exercises page-list parity.
2. ~~**App/repo name**~~ **Resolved: "Story Tale Reader"**, repo `story-tale-reader`, Android application id `com.kramdath.storytalereader`.
3. ~~**Bookmarks in v1, or M5?**~~ **Resolved: M5 or later.** Not in the M1–M4 scope. Resume-position (§6.2) is separate and ships in M2.
4. ~~**Landscape phone**: spread or single page?~~ **Resolved: always spread in landscape.** No minimum per-page width gate — if the frame is landscape and `rendition:spread` allows it, pair the pages. Pinch-zoom (§6.2) covers the small-screen case.

---

## Appendix A — reference book fingerprint

```
Title            Amelia Bedelia Is for the Birds
ISBN             9780062334268           Publisher  HarperCollins
EPUB version     3.0                     Size       17 MB, 129 files
rendition:layout pre-paginated           spread     landscape      orientation  auto
Spine            35 items (cover, 2 title, 29 content, copyright, parents, backad)
Page viewport    800 × 1200 CSS px (per-document <meta name="viewport">)
Images           800 × 1199 JPEG, one per page
Fonts            9 embedded WOFF (Times LT, Futura Std, ZiptyDo, AGaramond)
Audio            audio/abforthebirds.m4a — 6:48
Media overlays   27 SMIL files, per-word <par>; shortest word 62 ms
active-class     -epub-media-overlay-active  (styled red by the book's own CSS)
Spread hints     NONE in spine → derive from nav page-list (cover=1 … page032=32)
Text blocks      up to 3 independently positioned blocks per page (e.g. page025)
```

## Appendix B — why each observed failure disappears

| Failure | Fixed by |
|---|---|
| **F1** text below image | §5.4 — render each page in an iframe at its intrinsic viewport with the publisher's stylesheet intact, scaled by CSS transform. The publisher's absolute positioning does the rest. |
| **F2** one page at a time | §5.3 — honor `rendition:spread`, synthesize spreads in landscape. |
| **F3** spreads paired off-by-one | §5.3 — derive parity from the nav `page-list` when the spine has no `page-spread-*` properties; §6.4 — one-tap shift override for anything still wrong. |
