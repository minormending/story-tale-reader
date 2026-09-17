# Story Tale Reader

A fixed-layout-first ebook reader for children's picture books.

Most EPUB readers push fixed-layout books through their *reflowable* pipeline: they
discard the publisher's stylesheet and per-page viewport, so the illustration renders
as one block with all the text dumped underneath it, and two-page spreads either show
one page at a time or pair off by one. Story Tale Reader implements the EPUB 3
Fixed-Layout Documents spec properly, so the text stays exactly where the illustrator
put it.

It also plays **read-along narration with word-level highlighting** (EPUB 3 Media
Overlays) — a feature almost no Android reader supports, despite the timing data
shipping inside the books.

- **No accounts, no network, no telemetry, no ads.** Everything runs locally.
- Works fully offline once installed.
- Opens files you already have. **No DRM is circumvented** — encrypted files are
  rejected at import with an explanation.

## Status

See [SPEC.md](./SPEC.md) for the full technical specification and milestone plan.

## Development

```bash
npm install
npm run dev
```

Put real books for testing in `corpus/local/` — that directory is gitignored, because
commercial children's books are in copyright and must not be committed.

## License

MIT for the code. No book content is distributed with this repository.
