# What the research says a children's reader should do

Notes from the literature on children's digital books, and what follows for this
one. Written because the obvious next features — the ones every competing app
ships — are the ones the evidence says make comprehension *worse*.

Sources are listed at the end. Effect sizes are quoted as the papers report them.

## The short version

1. **Digitising a book, by itself, makes it worse.** A meta-analysis of 39 studies
   found lower comprehension for digital books that differed from paper only by
   being digital.
2. **What redeems a digital book is enhancement congruent with the story** —
   narration, the illustrator's own artwork, sound that belongs to the scene. With
   those, digital beat paper.
3. **Interactive extras hurt.** Hotspots, mini-games and in-story dictionaries
   distract, and the harm falls hardest on children from less stimulating home
   environments — the children an app like this could help most.
4. **An adult reading with the child beats any of it.** Adult mediation of a paper
   book outperformed enhancements in a digital book read alone.

The reader already sits on the right side of points 1–3, mostly by omission: it adds
nothing to the publisher's book, it plays the book's own narration, and it has no
games. That is worth stating plainly, because it means **the strongest design move
available is usually to refuse a feature**, and a refusal is hard to argue for
without evidence in hand.

Point 4 is the one the reader does least about, and where the room is.

## What the evidence rules out

| Feature | Why not |
|---|---|
| Tappable hotspots on the artwork | Distracting; no comprehension benefit in either meta-analysis. Both note they interrupt the flow of the story |
| Mini-games between pages | Negative effect on story comprehension |
| Quiz questions during the story | No benefit; introduce pauses that break story processing |
| A dictionary that interrupts reading | No or negative effect on comprehension — though it *does* help vocabulary, which matters below |
| Badges, streaks, reading goals | Not directly studied here, but the same mechanism: attention spent on the reward is attention off the story |

This list is the useful half of the research. Every one of these is a feature a
reasonable person would suggest, several ship in the best-known children's reading
apps, and the evidence is against all of them.

## What the evidence supports

### Word-level highlighting synchronised with narration — **built**

Word-by-word highlighting in time with speech helps children connect print with the
speech they hear, and the temporal pairing supports orthographic learning. This is
the reader's central feature and the research backs it.

One caveat worth designing around: eye-tracking of pre-K children found they spent
**82%** of fixations on pictures and **16%** on text. Where they did look at text,
about half the fixations coincided with the synchronised cue. A highlight that is
easy to miss is a highlight that does little — the book's own `media:active-class`
decides this today, and a book that styles it faintly gets a faint result.

### Extra letter spacing — **not built**

Increasing inter-letter spacing let dyslexic children around age 10 read about
**10% faster with roughly half the errors**, replicated across Italian and French.
The interpretation is contested — critics argue the benefit may extend to poor
readers generally rather than being dyslexia-specific — but that argument does not
weaken the case for *offering* it.

The reflowable viewer already has size, typeface and line spacing. Letter and word
spacing are the missing controls, and they are the ones with a number attached.

### Dyslexia-branded fonts — **deliberately not**

OpenDyslexic showed **no improvement** in reading rate or accuracy against Arial and
Times New Roman for elementary students with dyslexia, across letter naming, word
reading and nonsense-word reading — and none of the children said they preferred it. Several competing apps advertise it
as an accessibility feature. If it is ever offered here it should be as a
preference, not as a claim, and spacing controls should come first.

### Bigger targets for small hands — **partly built**

Recommended touch targets for young children are around **2cm square**, roughly four
times the adult guideline, because fine motor control is still developing and miss
rates are substantially higher. The reader uses 44px throughout, which is the *adult*
minimum.

Lock mode is where this matters: it exists precisely for the moment a tablet is in a
child's hands.

### Vocabulary support, after the story rather than during it

A dictionary hurt comprehension but **helped vocabulary learning**. Those are not in
conflict — they say *when*, not *whether*. Words looked at after the book is finished
cost the story nothing.

### Anything that helps an adult read along

The largest effect in the paper-versus-screen analysis was not a feature at all: it
was an adult reading with the child. A reader that makes the grown-up's job easier is
working on the biggest lever available, and this is the least explored direction
here.

## Candidate features, in the order I would build them

1. **Letter and word spacing in the reflowable menu.** Evidence-backed, small, sits
   beside controls that already exist. The one change here with a measured effect
   size behind it.
2. **A child-sized lock mode.** When locked, grow the page-turn zones and the padlock
   toward the 2cm guidance. Lock mode already means "a child is holding this"; it
   should change the geometry, not just hide the exit.
3. **Replay the page.** One control to hear the current spread again, without
   rewinding by hand. Repetition is how early readers use a book, and this adds no
   content and interrupts nothing.
4. **"Read to me" / "Read together" / "Read myself" — built.** Three named modes
   replace the "turn the page automatically" toggle, and the choice is remembered
   across books. *Read together* narrates each spread, stops, and holds the chrome
   up so the grown-up has the page-turn control to hand — the one direct answer in
   this list to the largest effect anybody measured. Reading still begins with
   play in every mode. See SPEC.md §7.3.
5. **A word list after the book — built.** The words the child tapped during
   reading, offered at the end. The list is reachable only on the last spread,
   because a list that can be opened mid-story is the in-story dictionary this
   very table argues against. See SPEC.md §7.6.
6. **Highlight strength — built.** An override for books whose own active-class
   styling is too faint to notice, given where children actually look. The book's
   own styling stays the default; "Stronger" overrides it. See SPEC.md §7.5.

All six are built.

What the list cost, for the record: almost nothing new. The reader could already
speak a tapped word, so the feature is one store, one restriction on when it
appears, and the decision not to add a dictionary — which is the part the evidence
actually asked for.

Worth recording what number 4 cost, because it argues for doing 5 and 6: the
behaviour was almost entirely already there. What was missing was a name for it.
The reader could auto-advance, could stop at the end of a page, and could speak a
tapped word, but it described those as a checkbox about page turns, so the mode the
research most supports — an adult reading alongside — was available and invisible.

## What I would not build, and why it is tempting

Animated characters, tappable scenery, a game between chapters, a quiz at the end, a
reading streak. Every one of them demos well, and the evidence says they cost the
child comprehension. The reader's pitch is that the book arrives intact — that is
also, as it happens, what the research recommends.

## Sources

- Takacs, Swart & Bus (2015), *Benefits and Pitfalls of Multimedia and Interactive
  Features in Technology-Enhanced Storybooks: A Meta-Analysis*, Review of
  Educational Research —
  <https://journals.sagepub.com/doi/10.3102/0034654314566989>
- *Which Interactive Features in Children's Digital Picture Books Promote Reading
  Comprehension? A Meta-Analysis* (2025), Early Education and Development —
  <https://www.tandfonline.com/doi/full/10.1080/10409289.2025.2571978>
- Furenes, Kucirkova & Bus (2021), *A Comparison of Children's Reading on Paper
  Versus Screen: A Meta-Analysis*, Review of Educational Research —
  <https://journals.sagepub.com/doi/10.3102/0034654321998074>
- Zorzi et al. (2012), *Extra-large letter spacing improves reading in dyslexia*,
  PNAS — <https://www.pnas.org/doi/full/10.1073/pnas.1205566109>
- Reply on the statistical and practical significance of that finding, PNAS —
  <https://www.pnas.org/doi/full/10.1073/pnas.1213265109>
- Wery & Diliberto (2017), *The effect of a specialized dyslexia font,
  OpenDyslexic, on reading rate and accuracy*, Annals of Dyslexia —
  <https://pubmed.ncbi.nlm.nih.gov/26993270/>
- Galliussi et al. (2020), *Inter-letter spacing, inter-word spacing, and font with
  dyslexia-friendly features*, Annals of Dyslexia —
  <https://link.springer.com/article/10.1007/s11881-020-00194-x>
- *The effect of visual cues in e-books on pre-K children's visual attention, word
  recognition, and comprehension: An eye tracking study* (2021), Journal of Research
  on Technology in Education —
  <https://www.tandfonline.com/doi/abs/10.1080/15391523.2021.1938763>
- Nielsen Norman Group, *Design for Kids Based on Their Stage of Physical
  Development* — <https://www.nngroup.com/articles/children-ux-physical-development/>
- Soni et al. (2019), *A Framework of Touchscreen Interaction Design Recommendations
  for Children* — <https://init.cise.ufl.edu/wp-content/uploads/sites/378/2019/04/TIDRC-Framework-soni-et-al-IDC19-final.pdf>
