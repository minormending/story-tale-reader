# Contributing

Thanks for looking. This is a reader for children's picture books, and the bar for
changes is set by one question: **does a five-year-old's book still look the way the
illustrator drew it?**

## Read this first

Start with **[docs/](docs/README.md)**. It explains how the reader works, with
diagrams, and each page has collapsed *Advanced* sections holding the reasoning you
would need before changing that area.

| If you are about to… | Read |
|---|---|
| Find your way around at all | [docs/architecture.md](docs/architecture.md) |
| Touch parsing, importing or rendering | [docs/opening-a-book.md](docs/opening-a-book.md) |
| Touch layout, viewports or page pairing | [docs/fixed-layout.md](docs/fixed-layout.md) |
| Touch narration or highlighting | [docs/read-along.md](docs/read-along.md) |
| Touch the library, storage or offline | [docs/storage-and-offline.md](docs/storage-and-offline.md) |

**[SPEC.md](SPEC.md)** is the contract — what the reader promises, what is built, and
what is deliberately missing. If a change contradicts the SPEC, the SPEC needs
updating in the same commit; if they disagree afterwards, the SPEC wins and the code
is the bug.

## Getting set up

```bash
npm install
npm run dev
```

Books in `corpus/local/` appear on the library screen under **Development corpus**.
That folder is gitignored and must stay that way — see [Books](#books) below.

```bash
npm test          # ~100 unit tests, under a second
npm run typecheck # types only; emits nothing
npm run build     # production bundle
npm run fixtures  # regenerate corpus/fixtures
```

Run `npm test` and `npm run typecheck` before you push. CI runs both on every push to
`main` and on every pull request, plus a production build.

## How changes land

History on `main` is linear — no merge commits. Small changes go straight to `main`;
anything you want a second opinion on goes through a pull request, which CI checks
the same way.

### Commit messages

Look at `git log` and match it. The convention here is a plain sentence describing
what changed, then a body explaining **why**, in prose:

```
Let the bars retire after a press, not only after a keyboard visit

The focus guard added with the auto-hide was too broad. It kept the bars
up whenever focus was anywhere inside them, and a press leaves focus on
the button it pressed — so one tap of Next pinned the toolbars up for the
rest of the book.
```

No `feat:`/`fix:` prefixes, no ticket numbers, no changelog file. The body is where
the value is: state the problem the change solves, and what you verified. A future
reader wants to know *why this is like this*, and the commit is usually the only
place that answer exists.

## What "done" looks like

A change is finished when all of these are true.

- **Tests cover the rule, not the render.** If you changed how spreads pair, add a
  case to `src/engine/layout/spread.test.ts`. Anything decidable from the file alone
  belongs in `engine/` and should be testable without a DOM.
- **You verified it on a real book.** Unit tests do not catch "the words are on the
  wrong page". Open something from `corpus/local/` and look at it.
- **Comments explain why, not what.** The code says what. Match the density around
  you: this codebase leans on comments to record the reasoning behind non-obvious
  decisions, and those are the comments worth writing.
- **The SPEC matches.** If you built something it promised, mark it built. If you
  built something it never mentioned, add it — the table of contents was an omission
  from the SPEC, not a deferred feature, and saying so is part of the change.

<details>
<summary><b>The one architectural rule</b></summary>

`src/engine/` imports from nothing else in `src/`. Everything else may depend on it.

That one-way arrow is what keeps the hard parts testable: spread pairing is a pure
function from page metadata to sides, so fourteen cases run in milliseconds with no
browser. The moment the engine reaches for a `Document`, that stops being true.

The test for where code belongs is *"can this be decided from the file alone?"* If a
function needs `getBoundingClientRect`, it is not engine code — it belongs in
`src/reader/` or `src/ui/`. The temptation always runs one way, because a layout
question looks answerable from metadata right up until it isn't.
</details>

## Books

**Never commit a book you did not generate.** `corpus/local/` is gitignored because
development runs against real, in-copyright children's books, and they must not enter
the repository — SPEC.md §12.

Committed test books live in `corpus/fixtures/` and are synthetic, built by
`scripts/build-fixtures.mjs`. They encode the *structures* that break real readers —
missing spread metadata, explicit properties, RTL, a pre-composed spread page, media
overlays — without shipping anyone's artwork. Each fixed-layout fixture draws a circle
across the gutter so a mispaired spread is visible at a glance.

Regenerating rewrites **every** fixture, because the zip records a modification time.
Only commit the ones whose contents actually changed; `corpus/README.md` says so too.

The reader also never circumvents DRM. Encrypted books are refused at import with an
explanation, and that is the whole policy.

## The UI audit

Screens are checked by [ui-audit](https://github.com/minormending/ui-audit), a
separate repo running Playwright and axe-core against a list of targets. It covers
this app across three viewports for visual regressions, accessibility, layout and
console errors.

If you add a screen or a state worth protecting, add a state to this project's entry
in that repo's `targets.json`, then regenerate the Linux baselines through its
`baselines.yml` workflow before running the audit.

Two things learned the hard way, worth repeating:

- **Assert behaviour in the `open` steps, not in the screenshot.** A contents list
  that renders but does not navigate passes a screenshot and fails a reader.
- **Do not assert anything viewport-dependent.** The page indicator counts spreads on
  a wide screen and single pages on a narrow one, so the same jump reads `2 / 16` or
  `3 / 31`. Assert something that means the same thing everywhere.

## Releasing

See [docs/release.md](docs/release.md). Pages deploys on every push to `main`;
pushing a `v*` tag builds and publishes a signed APK.

**Do not tag tooling- or test-only work.** A version that changes nothing a reader
can see costs a published release and an APK identical to the one before it. Let that
work ride along with the next tag that carries a user-facing change.

## Testing on a device

Three of the remaining gaps in SPEC.md §13 are open only because nobody has run the
app on real hardware — "Open with" from a file manager, two-finger pinch, and the
screen staying on. If you have an Android tablet,
[docs/device-test.md](docs/device-test.md) is a checklist against a published APK,
and a plain "all fine on a Galaxy Tab A9, WebView 131" closes them.
