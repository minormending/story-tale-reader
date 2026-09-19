# Story Tale Reader

A fixed-layout-first ebook reader for children's picture books.
**[Open the web app →](https://minormending.github.io/story-tale-reader/)**

Most EPUB readers push fixed-layout books through their *reflowable* pipeline: they
discard the publisher's stylesheet and per-page viewport, so the illustration renders
as one block with all the text dumped underneath it, and two-page spreads either show
one page at a time or pair off by one. Story Tale Reader implements the EPUB 3
Fixed-Layout Documents specification properly, so the words stay exactly where the
illustrator put them.

It also plays **read-along narration with word-level highlighting** (EPUB 3 Media
Overlays) — a feature almost no Android reader supports, despite the timing data
shipping inside the books.

## Documentation

- **[docs/](docs/README.md)** — how the reader works, for someone new to the code:
  [architecture](docs/architecture.md), [opening a book](docs/opening-a-book.md),
  [fixed layout and spreads](docs/fixed-layout.md), [read-along](docs/read-along.md),
  [storage and offline](docs/storage-and-offline.md). Diagrams throughout, with
  collapsed **Advanced** sections for the details behind each decision.
- **[SPEC.md](SPEC.md)** — the contract: what is promised, what is built, what is
  deliberately missing.
- **[docs/device-test.md](docs/device-test.md)** — checking a build on real hardware.
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — setup, conventions, and what “done” means here.

## What it does

- **Fixed-layout EPUB**, rendered the way it was drawn. Each page gets an iframe at its
  own intrinsic viewport, scaled with a CSS transform, publisher stylesheet untouched.
- **Spreads that actually pair.** Explicit `page-spread-*` properties when a book has
  them, printed page numbers from the nav `page-list` when it doesn't, page order as a
  last resort — plus a one-tap **shift** toggle for any book still guessed wrong.
- **Read-along.** The book's own narration, with each word highlighted as it is spoken.
  Tap any word to hear it from there. 0.75× / 1× / 1.25×, optional automatic page turns.
- **Reflowable EPUB** with size, typeface, spacing and colour settings.
- **PDF** and **MOBI / AZW3**, sharing the same viewer, spread pairing and library.
- **Fully offline.** No accounts, no network at runtime, no telemetry, no ads.
- **No DRM circumvention.** Encrypted files are refused at import with an explanation.

## Install

- **Web / tablet:** open the [web app](https://minormending.github.io/story-tale-reader/)
  and use your browser's "Install app" / "Add to Home Screen".
- **Android:** download the APK from
  [Releases](https://github.com/minormending/story-tale-reader/releases) and sideload it.
  Android 7.0 (API 24) or newer.

Books stay on your device. Add them with the file picker, by dropping them on the
window, or — on Android — with "Open with" from any file manager.

A public-domain sample, **The Tale of Peter Rabbit** (Beatrix Potter, 1902), is one
tap away on the empty shelf, so you can see what the reader does before finding a
book of your own.

## Development

```bash
npm install
npm run dev
```

| Script | Does |
|---|---|
| `npm run dev` | Dev server, with `corpus/` served for testing |
| `npm test` | Unit tests (90, no browser needed) |
| `npm run fixtures` | Regenerate the synthetic test books in `corpus/fixtures/` |
| `npm run icons` | Rasterise `public/icon.svg` into PWA and Android icons |
| `npm run sample` | Rebuild the bundled Peter Rabbit sample from its public-domain source |
| `npm run android:sync` | Build the web app and sync it into the Capacitor project |

Put real books for testing in `corpus/local/` — that directory is gitignored, because
commercial children's books are in copyright and must not be committed. Tests that
need them skip themselves when they are absent.

## Documentation

- [SPEC.md](./SPEC.md) — the technical specification: why readers break these books,
  how the layout engine works, and what is deliberately out of scope.
- [docs/release.md](./docs/release.md) — cutting a release and Android signing.

## License

MIT — see [LICENSE](LICENSE). That covers the code; no in-copyright book content is
distributed with this repository. The bundled sample is public domain and the test
fixtures are generated.
