# Device test checklist

Everything in this reader has been exercised running, but some of it has only ever
been exercised by a mouse and synthetic pointer events. Touch is not a mouse: it
captures a pointer to its original target, the browser arbitrates multi-touch
differently, and an Android WebView applies power and autoplay policies that a
desktop Chrome does not. SPEC.md §13 lists four gaps that only a real device can
close, and they are §§1, 2, 3 and 5 below.

Work through it on an Android tablet — that is the machine this project exists for.
A phone is worth a second pass, since the reader shows single pages where a tablet
shows spreads.

## Record before starting

- Device and Android version:
- WebView version (Settings → Apps → Android System WebView):
- APK version tested (the number on the library screen's button):

The WebView version matters more than Android's. SPEC.md §5 sets the floor at
Chromium WebView 100, and everything below leans on that.

## 0. Install

1. Download `story-tale-reader-<version>.apk` from the
   [latest release](https://github.com/minormending/story-tale-reader/releases/latest).
2. Allow installs from your browser or file manager when prompted.
3. Open the app once and confirm the library screen appears.

Every published APK is signed with the same release key, so upgrading over an
earlier one keeps the shelf. A signature-mismatch error means a *debug* build is
installed — uninstall it first, which does erase the shelf.

---

## 1. "Open with", from a file manager — SPEC.md §13

This is the one that compiles in CI and has never run. The manifest registers three
separate routes and they fail independently, so test all three.

- [ ] **By declared type.** In a file manager, tap an `.epub`. If offered a chooser,
      pick Story Tale Reader. → The book opens, straight into the reader.
- [ ] **By extension.** Repeat with a file the manager reports as
      `application/octet-stream`, which many do. → Opens the same way.
      This is a separate intent filter from the one above; the first can work while
      this one does not.
- [ ] **Share sheet.** From the file manager or a cloud app, Share → Story Tale
      Reader. → Opens.
- [ ] **Cold start.** Force-stop the app, then open a book from the file manager.
      → Opens, without a visible flash of the library first.
- [ ] **Already running.** With the app open on the library, switch to the file
      manager and open a book. → The running app takes the book.
      *Cold start and running are handled by different code paths — one collects the
      file at launch, one listens while alive — so one can work while the other
      does nothing.*
- [ ] Repeat once each with `.pdf` and `.mobi` or `.azw3`.

If nothing happens at all, note whether Story Tale Reader even appears in the
chooser: absent means the intent filter did not match, present-but-dead means the
file reached the app and the handover failed.

## 2. Pinch to zoom — SPEC.md §13

Verified with a mouse and synthetic pointers only. Two-finger gestures are exactly
where synthetic pointers are least like fingers.

- [ ] Pinch out on a spread. → Zooms smoothly, up to 4×, and stops there.
- [ ] Drag while zoomed. → Pans, and stops at the edges rather than flinging the
      page off-screen.
- [ ] A detail that crosses the gutter stays whole while zooming — the whole spread
      zooms, not one page.
- [ ] **Single** tap. → Resets to 1×. (Single, not double: at 1× a tap in the outer
      third turns the page, so a double tap would fire two turns first.)
- [ ] Zoom in, then turn the page. → The new spread arrives unzoomed.
- [ ] Pinch and pan repeatedly, quickly. → No stuck zoom state, no page turning
      mid-pinch.

That last one is the real risk: a second finger landing slightly late can read as a
tap in the page-turn zone.

## 3. Lock mode and the screen staying on — SPEC.md §13

- [ ] Press the padlock. → Back and "Fix layout" disappear; the padlock shows locked.
- [ ] Try to leave: press where Back was, use the system Back gesture. → Stays in
      the book.
- [ ] Taps and swipes still turn pages while locked.
- [ ] Tap the centre. → The bars come back. *Needed, because they auto-hide and the
      padlock is the only way out.*
- [ ] Hold the padlock for three seconds. → Progress shows, then it unlocks. A
      shorter press does nothing.
- [ ] **Hand it to a child, locked, for a few minutes.** → They cannot leave the
      book. This is the actual acceptance test.

**Screen staying on** — this has never been seen holding, only failing in the way a
hidden page is supposed to:

- [ ] Set the device's screen timeout to 30 seconds. Open a book. Do not touch it.
      → The screen stays on past 30 seconds.
- [ ] Switch away and back. → Still stays on. *The lock is dropped when the page is
      hidden and has to be re-acquired; this is the half most likely to be broken.*
- [ ] Leave the library screen idle instead. → The screen sleeps normally. The lock
      is for reading, not for the app.

## 4. The bars getting out of the way

New in v0.3.2, and the fix turned on `:focus-visible`, which touch and mouse report
differently. Worth real fingers.

- [ ] Open a book, do not touch. → After ~3 seconds both bars retire.
- [ ] Tap the centre. → They come back, then retire again.
- [ ] **Tap Next, then wait.** → They retire ~3 seconds later. *If they stay up for
      good, the focus guard is treating a tap as a keyboard visit — the exact bug
      fixed in v0.3.2, returning on real touch.*
- [ ] On a reflowable book with the bars down, check the last line of a screen is
      fully readable, not clipped.
- [ ] Open the menu and wait. → The bars stay while it is open.

## 5. Read-along, on a narrated book

- [ ] Press play. → Audio plays and words highlight in time.
- [ ] Tap a word mid-sentence. → Reading jumps to that word rather than turning the
      page. *Try words near the left and right edges, where the page-turn zones are.*
- [ ] Let a spread finish. → The page turns and reading continues.
- [ ] Let the narration run out. → Reading stops and the control disappears, rather
      than hanging.
- [ ] Lock the screen mid-sentence, then unlock. → Audio behaves sanely (either
      continues or pauses cleanly; note which).
- [ ] Turn the volume down to zero and back. → No stuck state.

## 6. Turning pages, and the layout itself

- [ ] Swipe left and right. → Turns, both ways.
- [ ] Swipe starting **on an illustration**. → Still turns. *Native image dragging
      cancels the gesture; this is guarded, and touch is where it would resurface.*
- [ ] Tap the outer thirds. → Turns.
- [ ] Rotate to landscape. → Facing pages appear side by side, and a picture
      crossing the gutter lines up.
- [ ] Rotate to portrait. → Single pages, nothing cropped.
- [ ] Find a book that pairs wrongly, open the menu, press "Shift spread pairing".
      → The pairing corrects, and the label reads *shifted*.
- [ ] Contents (new in v0.4.0): open the menu, press an entry. → Goes there, and the
      entry is marked when you reopen the menu.
- [ ] The second button on the library reads **"Add several"**, not "Add a folder".
      → Pressing it opens the ordinary file picker with multi-selection. Android
      cannot choose a directory at all, so a folder button there would open the
      wrong dialog; picking several books is the whole of what the platform offers.
      Select three or four at once and check they all arrive.

## 7. Storage and offline

- [ ] Add several books. Force-stop. Reopen. → All still on the shelf, covers intact.
- [ ] Read into a book, leave, reopen. → Resumes where you left off.
- [ ] On a reflowable book: bookmark a place, make the text larger, reopen the
      bookmark. → Lands on the same text, not the same screen number.
- [ ] **Airplane mode from a cold start.** → The app opens and every book on the
      shelf reads normally.
- [ ] Fill the device near full, then add a large book. → Either it is added, or a
      clear message says there was no room. Never a silent failure or a broken shelf.

## What to send back

For anything that fails, the useful things are:

1. Which checkbox, and what happened instead.
2. A screen recording if it is a gesture — gesture bugs are almost impossible to
   describe.
3. `adb logcat | grep -i chromium` while reproducing, if you have adb. WebView
   console errors land there and are otherwise invisible on a device.
4. The version number from the library screen's button, so it is clear which build
   the report is about.

A pass is worth reporting too. Four of these are open questions in SPEC.md §13
purely because nobody has run them on hardware, and a plain "all fine on a Galaxy
Tab A9, WebView 131" closes them.
