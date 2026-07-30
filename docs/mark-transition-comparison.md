# Four ways to change the mark — the comparison, and the rig that settles it

> **⚠ Superseded in part, 2026-07-30.** The `hard-cut` control and the first accretion attempt were
> **built and rejected, then deleted.** `hard-cut` no longer exists as a candidate id, so §5's
> instruction to put the control first no longer applies — reinstate it in ~40 lines if a measured
> baseline is wanted again. ④ accretion is being rebuilt from a proper design:
> **`docs/accretion-plan.md`**, whose §1 lists the six specific reasons the first attempt looked bad.
> Everything below about ① ② ③ and about the rig's instruments still stands.

> **Status:** comparison + instrumentation spec. Written 2026-07-30, alongside
> `docs/mark-to-mark-transition-plan.md` (which describes ① ② ③) and the accretion idea (④, yours).
>
> **The point of this document:** all four can be made to *look* good. They differ most on things you
> cannot see by looking — build cost, scaling to six marks, what happens when they fail, and whether
> they can share the frame with the chamber. So the comparison is deliberately weighted away from shape,
> and §5 specifies what the lab has to **measure** rather than merely display.

---

## 1 · The four, and what carries identity

```
   ①  ONE SKIN          ②  SHARDS            ③  FIELD             ④  ACCRETION
   connectivity          pieces               a function           a seed

   one mesh forever,     N cells that tile    no mesh; a signed    a persistent base rock;
   every mark is a set   the mark exactly;    distance function    smaller rocks grow out
   of target positions   cell i → cell i      per mark, raymarched of it to compose the mark

   ▟███▙                  ▗▘ ◣ ▝▖             ▟▙  ▟▙               ●▟█▙●
   ██ ██  ─lerp─▶        ◤  ▗▚  ◥            ██   █▙              ●●███●●
   ▜███▛                  ▝▖ ◢ ▗▘             ▜█▄▄█▛               ●▜█▛●

   "metal setting"       "it comes apart      "impossible          "it grows, and the
                          and reassembles"     material"            mess is the twist"
```

Nothing else is possible: a shape's identity across a change can only be carried by its
connectivity, its pieces, a function, or a source it grows from. That's why there are four and not
seven.

---

## 2 · The one question that kills each

This is the most useful thing in the document. **Each approach has exactly one observation that
either kills it or clears it**, and the whole reason to build four tabs is to answer four questions:

| | The question | How the lab answers it |
|---|---|---|
| **①** | Can one fixed canonical density hold a *fine* logo detail crisply — the shield's checkers, the compass ring's stroke? | Silhouette-error overlay on the shield at rest. If the geometry deviates visibly from the true outline anywhere, ① needs more density or dies. |
| **②** | Do the seams show at rest, and does the shard correspondence read as *rearrangement* rather than as noise? | Look at a resting mark at grazing angles for cracks; scrub 0→1 slowly and see whether the eye can follow pieces. |
| **③** | Does the frame cost fit alongside the chamber's render-to-texture and the bloom pass? | Frame-time p95 during the transition, on the `low` tier, with the field's real pass stack. |
| **④** | Can a union of grown rocks render a *logo* legibly — not a letter, a logo? | Silhouette-error overlay on the compass at rest. A "V" will pass; the question is only ever the fine marks. |

Note the symmetry: ① and ④ are both killed or cleared by **the same test on the same two marks**, and
that test is not "does it look nice". That is why the overlay in §5 matters more than the pretty view.

---

## 3 · The full comparison

Weighted as asked — shape is one row of twelve.

| | ① One skin | ② Shards | ③ Field | ④ Accretion |
|---|---|---|---|---|
| **Crisp at rest** | exact (boundary vertices sit on the outline) | exact (cells are a fracture of the real mark) | exact (analytic, sharper than any mesh) | **approximate** — union of rocks |
| **Mid-transition read** | one body flowing; holes heal shut | real debris; the most kinetic | material necks and splits; the most convincing | deliberate mess, then order |
| **Topology risk** | none — fixed once, for all marks | none — every cell is genus 0 | none — a field has no topology | none — a hole is where nothing grew |
| **Multi-part marks** | reserved spare discs, collapsed to ε | free | free | free |
| **Draw calls** | 1 | 1 | 1 (a quad) | 2 (base + instances) |
| **Vertices drawn** | ~8–10k | ~12k (padded) | 4 | ~65k, but instanced from 162 |
| **Fill cost** | ordinary | ordinary | **the dominant cost** | ordinary |
| **Build cost / mark** | ~50–200 ms (solve + inverse) | ~200–600 ms (fracture) → **bake offline** | ~5 ms (SDF raster) | ~10–30 ms (dart-throwing fill) |
| **Scaling 4 → 6 marks** | +2 solves, ~0.4 MB | +2 bakes, asset size grows | +2 SDF textures (~1 MB) | trivial |
| **Reuses shipped code** | **almost all** — `enableMeteorMorph`, `attachMorphTarget`, `bakeMorphTarget`, `markDiscMap`, the 2-group material trick | the morph/bake pattern; the swarm's instancing thinking | almost none — needs a hand-written material | **the swarm, nearly wholesale** |
| **Correspondence problem** | boundary phase alignment (1-D search) | cell→cell assignment (space-filling sort) | **none** | **none** |
| **Failure mode** | soft — a slightly imprecise outline | hard — visible cracks, or noise | hard — frame drops | soft — a mushy silhouette |

### The rows that actually decide it

**Reuse.** ① and ④ sit on machinery that already ships and has already had its traps found — the
`attachMorphTarget` buffer-reuse fix (a new `BufferAttribute` per swap orphans ~5.9 MB a step), the
radial-not-normal swell rule, the two-material group split that `ExtrudeGeometry` hands you for free.
③ re-implements the basalt-and-veins look from scratch. That is not a reason to reject ③, but it is
the reason ③ must be prototyped before it is promised.

**Correspondence.** ② and ① both need a matching step, and a bad match is what turns a rearrangement
into a particle effect. ③ and ④ need none at all — ④ because nothing travels (things shrink and other
things grow), ③ because a field has no parts to match. **This is ④'s real, underrated advantage** and
it is invisible on any single frame.

**Failure mode.** ① and ④ fail *softly*: you get a mark that is slightly less precise than you wanted,
and you can trade density or rock count against it. ② and ③ fail *hard*: a crack you can see through,
or a frame-rate cliff. Soft failures are worth a lot on a site that has to run on someone else's
laptop.

**Build cost.** ②'s fracture is the only genuinely expensive build, and it has an obvious answer that
removes the flaw entirely: **the marks are static, so bake the fracture offline** with a script beside
`scripts/optimizeModels.mjs` and ship it as data. Do that and ② costs nothing at load.

---

## 4 · What each is *for* — the honest register

None of these is strictly better. They are different claims about what the studio is:

- **① says precision.** One continuous body that reshapes without seams. The most premium, the least
  showy. Scores on Visual Design and Technical Excellence.
- **② says force.** The mark comes apart and rebuilds. Best fit to the transition that already exists
  — the 1150°/s spin and the counter-whirling field are already violent, and ② is the only one that
  *matches* that energy rather than being flattered by it. Scores on Motion and Memorability.
- **③ says impossible.** Material that necks and splits like something with no polygons. Scores
  hardest on Innovation and Technical Excellence, and it is the only one a viewer cannot
  reverse-engineer in their head.
- **④ says alive and geological.** The mark is grown, not placed — and it keeps a persistent body at
  the centre across the whole section, which is the only one of the four that gives the *section* a
  continuous protagonist rather than four separate objects. Scores on Creativity and Memorability.

That last point about ④ is worth dwelling on: it is the only proposal where **something survives the
transition**. In ① the body is continuous but featureless-through-the-middle; in ② and ③ nothing
persists. ④'s base rock is on screen the entire time, and every mark is visibly *the same rock
expressing a different shape*. For a section whose job is "four projects, one studio", that is a real
narrative argument, and it is not a shape argument at all.

---

## 5 · The rig — what the lab must measure, not just show

A tab per approach, sharing one harness so the comparison is fair. **Every strategy gets the same
`targetSize`, the same `depth`, the same texture, the same lighting, the same bloom.** No strategy is
allowed to bring its own framing.

### Controls (shared, one set)

```
  ┌─ Transition ─────────────────────────────────────────────┐
  │  strategy   [ hard cut | one skin | shards | field | accretion ]
  │  from → to  [ signal ▾ ] → [ compass ▾ ]     ⇄ swap
  │  progress   ●───────────────────────────  0.42
  │  ▶ play     round trip  [ 1.0 s ]   ← MORPH_SECONDS
  │  □ step through all pairs (4×3 = 12 ordered pairs)
  └──────────────────────────────────────────────────────────┘
```

**`hard cut` is the control**, and it must be first in the list: it is exactly what ships today, so
every other tab is measured against the real baseline rather than against an idea of it.

### Instruments

| Instrument | Why it decides something |
|---|---|
| **Frame time p50 / p95**, at rest and mid-transition, separately | The only honest read on ③, and the thing that will kill it if anything does. Split rest vs transition because they differ by an order of magnitude for some strategies. |
| **Draw calls · triangles · programs**, read from `renderer.info` | Read from the renderer, **not self-reported** — a strategy must not be allowed to flatter itself. |
| **Build ms per mark**, and total | ②'s deciding number, and the input to the loader budget (`assetLoadProgress` weights a `works` source already). |
| **GPU bytes held, and bytes per mark** | Lets 4 → 6 marks be projected rather than guessed. |
| **Silhouette-error overlay** | The instrument that answers ① and ④. Draw the true vector outline as a hairline over the rendered mark; where geometry deviates, you see it exactly. Turns "does it read?" into a measurement. |
| **Silhouette-only view** (flat white on black, no lighting) | Lighting flatters a bad outline. This removes the flattery. |
| **Cross-section clip plane** | The only way to see ②'s interior seams and ④'s interior packing at all. |

### Fairness rules, written down so they don't erode

1. One harness owns the camera, lights, environment probe, bloom and the spin rig.
2. Every strategy normalises to the same `targetSize` and the same world-unit `depth`. (Letters need
   the `LETTER_SOURCE_SCALE` correction; `markGeodeBody` already gets this right and is the reference.)
3. `setTransition(from, to, progress)` is a **pure function** — no internal timers, no "arrived"
   flags. The play button drives progress; scrubbing must be identical to playing. This is the site's
   ONE CLOCK rule applied as a test instrument: anything that cannot be scrubbed cannot be trusted.
4. Metrics come from `renderer.info` and the harness's own frame clock. Strategies report only what
   the renderer cannot know: build time and bytes held.

---

## 6 · My prediction, and what would change it

**Predicted order:** ① ≈ ④ > ② > ③ — but for opposite reasons, which is why building all four is
actually the right call rather than an indulgence.

- **① wins on risk-adjusted value.** It converts today's hard cut into a real morph using code that
  already ships, and it absorbs the geode as a special case.
- **④ wins on narrative and on cost**, and it is the cheapest of the four to build because it needs no
  correspondence and reuses the swarm. Its only risk is the one thing the overlay will settle in a
  minute.
- **② wins the room** if the fracture bakes cleanly, and it is the best match for the transition
  choreography that already exists.
- **③ has the highest ceiling and the least certainty.** It is the one I would refuse to promise
  before measuring.

**What would change my mind:** if ④'s overlay shows the compass and shield read cleanly, ④ becomes
the recommendation outright — it is cheaper than ①, needs no correspondence, gives the section a
persistent protagonist, and its failure mode is soft. The reason I have not recommended it already is
purely that I do not believe a union of grown rocks can hold the compass ring's stroke, and I would
rather be shown wrong by the rig than argue about it.

---

## 7 · Build order

1. **The harness** — `transitions/markTransition.ts` (the contract), the lab's transition tab, and the
   instruments in §5. Plus `hardCutTransition.ts`, the control.
2. **④ accretion** — cheapest, reuses `markSwarm`, and answers its own killer question immediately.
3. **① one skin** — the canonical mesh, built on `markDiscMap` (already written and typechecking).
4. **② shards** — with the fracture baked by a script, not computed at load.
5. **③ field** — last, as a prototype with a stated go/no-go on frame time.

Each step ends with the tab working and its four numbers on screen, so the comparison sharpens as it
goes rather than arriving all at once at the end.
