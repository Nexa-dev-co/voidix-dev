# The Services vessel — one machine, assembled as you scroll

> **Status: BUILT** (2026-08-11). Branch `feat/services-vessel-assembly`, cut from `cleanup/dead-code-and-perf`.
> Steps 1–8 are shipped. **Step 0 — the spike — is the one thing still outstanding, and it is now a
> LOOK rather than a build: the ship is in the scene and wants eyes on it (see §2).**

---

## 1 · What changes, in one sentence

The Services section stops being **four stock ships shown one at a time** and becomes **one ship that
does not exist yet** — its parts adrift at the edges of the frame — which assembles itself across the
four stops and, complete and lit, flies you into Works.

```
  TODAY                                          PROPOSED
  ┌────────┐  gate  ┌────────┐  gate  ┌────────┐  ┌ ·  ·  ┐   ┌ ·   ┐   ┌     ┐   ┌     ┐
  │ ship A │ ──swap─│ ship B │ ──swap─│ ship C │  │ ·╱▔╲· │   │ ╱▔╲ │   │╱█▔█╲│   │╱█▔█╲│
  │        │        │        │        │        │  │ · ╲╱ ·│   │▟╲╱▙ │   │▟ ╲╱ ▙│  │▟▂╲╱▂▙│
  └────────┘        └────────┘        └────────┘  └ ·  ·  ┘   └ ·   ┘   └     ┘   └  ⚡  ┘
   01 Web            02 Mobile         03 Ent…      01 Web      02 Mob    03 Ent    04 AI
                                                    spine       +wings    +engines  +core
   four unrelated hulls, 5.15 MB                    one hull, 30 KB, built in front of you
```

The narrative this buys: **a studio that builds things demonstrates building.** Each service is not a
brochure item, it is a component of the machine. By the AI stop the machine is finished — and then it
is the thing that flies you out. The services→works flight stops being "a ship leaves" and becomes
"you leave in the ship you just watched them build."

---

## 2 · Step 0 — the spike, before anything else

**The single biggest risk is that the model is too small to carry the section, and no amount of
choreography fixes that.**

`temp/space-ship/source/12144400.obj` is **1,207 verts / 1,980 faces**. That is a twentieth of the
geometry of the hulls it replaces. It is a flat, wide, low-poly fighter — bbox `32.8 × 5.5 × 27.0`,
wingspan longer than the fuselage. Against it: the deck runs with **every stage light at zero**
(`deckTuning`), so a hull there is read almost entirely as silhouette + rim + its own emissive, which
is the lighting régime low-poly survives best in, and `hullMaterial`'s graded palette + clearcoat does
real work on flat faces.

So before a line of the rest of this is written:

1. Convert the OBJ to a GLB as-is (no splitting, no clustering, no waves).
2. Drop it into the existing deck as a fifth `DECK_SERVICES` entry with the Ember Noir profile.
3. Look at it at desktop and at 390px.

**If it holds the frame, everything below proceeds. If it doesn't, the concept survives but the model
does not, and we go and find a denser one before building the machinery.** The machinery is model-agnostic
by design — §5 keys everything off named nodes in the GLB, not off this particular ship.

Two things to settle during the spike, both of which need eyes rather than reasoning:

- **Which way is forward.** The thin plates at `z −13.4` are either the nose glass or the exhausts.
  The whole flight path steers by `HEADING_PHASE` ("nose screen-left datum") and gets the answer wrong
  by 180° if we guess. Settle it by looking, then bake it into `modelRotation`.
- **Whether the 182 KB texture is worth shipping.** Every face carries UVs (checked — 0 faces without),
  but there is no `.mtl` in the export, so the material assignment is ours to make anyway, and
  `hullMaterial` regrades the albedo through a three-tone luminance map regardless. It may add nothing.

---

## 3 · Why this model can come apart (the fact the plan rests on)

A ship only assembles if it has parts. The OBJ declares just three groups — `Object01`, `Object02`,
`Box01` — which is useless. But **welded connected-component analysis finds 39 separate mesh islands**,
and they are clean, mirror-paired and legible:

| islands | faces ea. | size (x×y×z) | centre | what it is |
|---|---|---|---|---|
| 0, 1 | 316 | 2.7 × 5.5 × 13.6 | ±3.4, −1.9, −9.4 | the two **nacelles** — biggest, tallest parts |
| 2, 3 | 160 | 8.8 × 2.6 × 21.5 | ±5.6, −2.5, 0 | the two **body plates** |
| 4 | 150 | 3.5 × 4.3 × 19.2 | 0, −2.5, −1.7 | the central **spine** |
| 7, 8 | 46 | 9.0 × 1.0 × 20.8 | ±11.9, −3.1, −5.4 | the **outer wings** (these are what make the 32.8 span) |
| 5, 6 | 48 | 2.0 × 1.9 × 0.2 | ±3.4, −1.9, −13.4 | thin end **caps** |
| 9–12 | 34 | 2.2 × 0.4 × 2.2 | ±3.3, −1.4/−3.6, −2.4 | 4 **vent discs**, above and below each nacelle |
| 13–18 | 28 | small | ±5.1, −1.7, −7.7/−9.1/−10.5 | 6 nacelle **side fins** |
| 19–26 | 28 | small | ±6.2/6.5, −1.9/−3.4, 0.7/1.9 | 8 wing **pods** |
| 27, 28 | 26 | 0.4 × 2.4 × 7.6 | ±4.9, −1.7, −9.9 | 2 tall **blade fins** |
| 29, 30 | 19 | 0.2 × 2.2 × 2.8 | ±2.0, −1.4, −8.3 | 2 inner **plates** |
| 31–34 | 10 | 0.4 × 1.5 × 2.0 | ±11.5/±8.2, −3.7 | 4 **winglets** |
| 35–38 | 8 | small | ±5.1/±2.5, −2.5, 1.2/2.6 | 4 rear **fittings** |

Every part has an exact mirror twin. That is a gift: a pair can fly in from **opposite sides of the
frame and meet in the middle**, which is a far better read than 39 things converging from everywhere.

---

## 4 · The four waves

Parts are grouped into **clusters** (one transform each, one draw call each), and clusters into four
**waves**, one per service. The grouping is narrative, not arbitrary — each wave is the part of a
machine that service actually is.

```
 WAVE 1 · 01 Web Experiences · THE FRAME              WAVE 2 · 02 Mobile Systems · THE REACH
 "the platform everything else mounts to"             "it extends; it goes further"
 ┌──────────────────────────┐                         ┌──────────────────────────┐
 │ spine        (island 4)  │  3 clusters             │ outer wings   (7, 8)     │  2 clusters
 │ body plates  (2, 3)      │  626 faces              │ winglets      (31–34)    │  204 faces
 └──────────────────────────┘                         │ wing pods     (19–26)    │
                                                      └──────────────────────────┘

 WAVE 3 · 03 Enterprise · THE POWER                   WAVE 4 · 04 AI · THE INTELLIGENCE
 "gravity for your pipeline" — throughput             "intelligence in orbit" — and IGNITION
 ┌──────────────────────────┐                         ┌──────────────────────────┐
 │ nacelles      (0, 1)     │  2 clusters             │ end caps      (5, 6)     │  2 clusters
 │ vent discs    (9–12)     │  1,000 faces            │ inner plates  (29, 30)   │  150 faces
 │ side fins     (13–18)    │                         │ rear fittings (35–38)    │  + the whole hull
 │ blade fins    (27, 28)   │                         └──────────────────────────┘    comes alive
 └──────────────────────────┘
```

**9 clusters ⇒ 9 draw calls** (measured, not estimated — see the build output in §5). Worth pricing
deliberately: the sun's audit put a draw call at **~0.02 ms**, so the whole disassembled vessel is
~0.18 ms — and unlike the sun, the deck's bloom pass ships **disabled** (`BLOOM_ENABLED = false`), so
nothing is submitted twice. Against that, four hulls at 5.15 MB became one at **30 KB**.

### Wave 4 is small on purpose

The AI wave is 150 faces of trim — deliberately. It does not need mass, it needs **effect**. The last
pieces snap home and the hull *ignites*: emissive comes up across every seam, the engine bells light,
the accent trim traces the silhouette, and the ship goes from dead metal to powered in about half a
second. That is the finale, and the finale is light, not geometry. It is also the same principle the
loader's gather field already uses — *"particles brighten as they lock in… this is what makes the
reveal read as building, not just arriving."*

---

## 5 · The build step — clustering happens at build time, not at runtime

`scripts/optimizeModels.mjs` reads **GLBs** out of `models-src/`, so an OBJ cannot enter that road
directly, and the clustering has to happen somewhere regardless. Both problems are one new script.

**`scripts/buildVessel.mjs`** — the road in from this raw OBJ:

```
 temp/space-ship/source/*.obj
        │
        │  1. parse v / vt / vn / f
        │  2. union-find over POSITION-WELDED verts   → 39 islands
        │  3. assign each island to a cluster by an AUTHORED table
        │     (matched on face-count + centroid, never on array order —
        │      array order is an artifact of the parse and would rot)
        │  4. per cluster: recentre geometry on its OWN centroid,
        │     translate the node back by it            ⚠ see below
        │  5. emit one named node per cluster: `w2_wing_left`, …
        ▼
 models-src/vessel.glb  ──►  npm run optimize:models  ──►  public/models/vessel.glb
                             (Draco + KTX2/ETC1S, the existing road)
```

⚠ **Step 4 is the one that is painful to retrofit.** A part must tumble about *itself* while it drifts.
If cluster geometry keeps the ship's origin, every loose part orbits the ship's centre instead of
spinning in place, and the whole swarm reads as a carousel rather than as debris. Recentre at build
time and the node's own translation *is* its socket — which §6 then needs anyway.

⚠ **Name the nodes.** `deckTuning`'s `hiddenParts` uses positional ids `<ship>:<mesh>` and its header
explains why: *"the vessels are third-party glbs whose mesh names are inconsistent, absent, or
duplicated — an index is the only identifier all of them actually have."* That reasoning expires here.
**We are generating this GLB**, so the names are ours and they should be load-bearing. The runtime then
reads waves off node names and never counts meshes.

This also makes the machinery model-agnostic: swapping in a different ship (see §2) is a new table in
`buildVessel.mjs`, not a rewrite of the scene.

---

## 6 · The rig — how a part is both loose and attached

Each cluster has exactly two poses, and its state is one number.

```
  holdingPose ──────────── assembly 0..1 ────────────► socketPose
  (frame-anchored,                                    (body-anchored,
   drifting, tumbling)                                 rigid with the hull)
```

The naïve build parents loose parts to a swarm group and **re-parents** them into the hull on lock.
Don't: a re-parent is a discontinuity, it happens mid-scrub, and it reverses badly. Instead every
cluster stays parented to `lift` for its whole life, and its transform each frame is a blend:

```ts
// socket in BODY space → world, through whatever `spin` is currently doing
socketWorld = spinMatrix × cluster.socketLocal
cluster.position.lerpVectors(holdingPosition, socketWorld, eased)
cluster.quaternion.slerpQuaternions(tumbleQuaternion, spinQuaternion, eased)
```

This falls out for free, and all of it is desirable:

- At `assembly = 1` the cluster is *exactly* rigid with the hull — no seam, no drift, nothing to
  reconcile before the flight.
- **Drag-to-look grabs a part in proportion to how attached it is.** A half-locked wing follows your
  drag halfway. Nobody will name it; everybody will feel it.
- It reverses perfectly, because it is a pure function of one scrubbed number (§7).

The rig grows one level:

```
  stage ─► depart ─► lift ─┬─► spin ─────► (empty — the reference frame the sockets resolve through)
                           └─► cluster ×10 (each blended between holding and socket)
```

`stage` (carousel), `depart` (the flight scrub), `lift` (hover/bob), `spin` (base yaw + drag) all keep
their current owners and meanings. **No change to `handoffFlightPath.ts`** — at handoff time every
cluster is at `assembly = 1`, so the flight sees one rigid ship exactly as it does today.

### The holding ring is where "responsive" actually lives

The user's ask — *parts appear from the sides of the screen, responsive to screen size* — is a
**screen-space** requirement, and it must be authored as one. Fixed world offsets fail exactly the way
the portal gates already documented:

> *"At portrait the visible half-width at the stage collapses to ~1.2 world units while every hull is
> normalised to 2.3, so a fixed lateral offset puts both gates off-screen by roughly 3×."*

So each cluster's holding pose is authored as **an angle and a radius on a ring measured in fractions
of the live frame**, resolved to world on every resize:

```ts
holdingX = cos(angle) × halfWidthAtDepth × radius
holdingY = sin(angle) × halfHeightAtDepth × radius
holdingZ = authored depth spread          // so it reads as a cloud, not a hoop
```

`frameAt(depth)` already exists — inside `computePortalLayout`. It gets promoted to
`ServicesDeck/deckFrame.ts` and is the only place the maths lives.

```
   LANDSCAPE (16:9)                        PORTRAIT (390px)
   ┌───────────────────────────────┐       ┌─────────────┐
   │ ◣        headline          ◹  │       │  ◣    ◹     │   the same authored angles,
   │◤                            ◥ │       │             │   resolved against a tall
   │      ╱▔╲       detail  ◺     │       │◤   ╱▔╲    ◥│   narrow frame — parts arrive
   │◣    ▟ ╲╱ ▙                    │       │   ▟ ╲╱ ▙    │   over the top and bottom
   │  ◹        01 02 03 04      ◤  │       │◣  ────── ◥ │   instead of the sides,
   └───────────────────────────────┘       │  ◺   01/04 │   with no second authoring
    parts arrive from left and right       └─────────────┘   pass and no breakpoint
```

Radius sits just under 1 for some clusters and just over for others, so the swarm is **partly in
frame** — the user asked for parts visibly floating, and a ring entirely off-screen shows nothing.
Angles are authored to favour the left/right edges and the vertical mid-band, because the headline
(top-left), the detail column (right) and the carousel strip (bottom) are already spoken for.

---

## 7 · The clock — one scrubbed number, per the spine's rules

`CLAUDE.md` rule 2: *every visual in a crossing is a pure function of its progress; no `gsap.to(…)`
with a duration, no "arrived" flags.* The services span is a carousel rather than a crossing, so the
current portal swap is allowed to be a ~2.8 s GSAP timeline. **The assembly should not be.** It is a
continuous physical process across the whole section, and the moment it is time-based it can be
outrun, it desyncs on a fast flick, and scrolling back does not take the ship apart.

So: **assembly is a pure function of the pin's services progress**, and wave *i* flies in over the
glide that *arrives* at stop *i*.

```
 pin progress ───────────────────────────────────────────────────────────────►
        fill        stop0        stop1        stop2        stop3    │ crossing
         │            │            │            │            │      │
         ├── wave1 ──►│            │            │            │      │
         │            ├── wave2 ──►│            │            │      │
         │            │            ├── wave3 ──►│            │      │
         │            │            │            ├── wave4 ──►│      │
         │            │            │            │       IGNITION    │
         ▼            ▼            ▼            ▼            ▼      ▼
      swarm only    frame        +reach      +power      COMPLETE   flies you out

   assemblyOf(wave) = smoothstep(windowStart, windowEnd, servicesProgress)
                      + a per-cluster stagger inside the window
```

Wave 1 rides the **hero→services reveal** rather than a stop-to-stop glide, which means the deck's
entrance simply *is* the frame being laid down — and `replayEntrance` / the portal swap timeline both
stop having a job. `HERO_SERVICES_PROGRESS_EVENT` already carries that span.

**This needs one new signal and nothing else.** The pin already computes continuous services progress —
it publishes it every frame as `--nav-progress-services` for the navbar meter, derived from
`carouselLayout`'s `firstStopProgress` + `meterSpan`. It just has to hand the same number to the deck.
New `lib/servicesAssemblyEvents.ts`, mirroring `handoffEvents.ts` exactly, consumed with the same
per-frame easing `departState` already uses.

⚠ **`computeCarouselLayout` is untouched. `carouselSections` is untouched. `STAGE_SCROLL_VH`,
`STAGE_STEP_HOLD_MS` and the crossing spans are untouched.** The scroll spine does not move at all —
which is the whole reason this is affordable. The existing 2,900 ms input hold per step already gives
each wave about the same 2.9 s the portal swap gets today, so the pacing is right without retuning.

### The lock

A part that lerps smoothly to its socket reads as *floating into place*. A machine part should
**arrive**. Per cluster:

1. **Travel (0 → 0.82)** — a curved approach, not a straight line: the part swings wide, keeping its
   tumble, decelerating.
2. **Align (0.82 → 0.92)** — tumble resolves to the socket's orientation; the part is now *presented*,
   held a hair outside its socket.
3. **Lock (0.92 → 1.0)** — a hard, fast close with a small overshoot, and a **seam flash** on the
   emissive at the contact.
4. **Kick** — the already-assembled body takes a small impulse on lock and damps it out, so the hull
   acknowledges being hit. (Derived from the same progress, so still no free clock.)

### Reduced motion

`prefersReducedMotion()` ⇒ assembly resolves to the wave's end state with no travel, no tumble, no
kick. The ship is simply complete-to-stop-*n*. The scrubbed spine itself is not gated (per
`docs/reduced-motion-plan.md`'s standing rule) — the *decoration* is.

---

## 8 · Colour — what happens to the four palettes

Four hulls carried four identities (`deckServices.ts`). One hull has to carry all four, and the answer
should not be "pick one".

**Each wave's parts arrive wearing their service's accent, and the accent stays as that region's
emissive trim.** The finished ship is visibly four disciplines fused — you can point at the wings and
say *that is the mobile work*. The hull body itself is one graded profile throughout: **Ember Noir**,
the existing `01` — a full-black hull, which is the site's own black and the correct substrate for
four different accents to sit on without competing.

| wave | accent | source | note |
|---|---|---|---|
| 1 · Web | `#a82600` (heat-300) | today's `01` rim | the frame glows at the seams |
| 2 · Mobile | `#cfe0f5` / rim `#8fb0dd` | today's `02` | the cool counterweight |
| 3 · Enterprise | `#ffb24d` | today's `03` | the warm engine light |
| 4 · AI | `#7a4ad0` → `#36e6ff` | today's `04` | **the one deliberate alien, kept** |

⚠ `CLAUDE.md` protects that last row explicitly — *"the fleet is allowed exactly one alien… Don't 'fix'
it to match the others."* On one hull it gets better, not worse: the alien is now the **core**, and its
purple→cyan is what floods the rest of the hull at ignition. The exception acquires a reason.

Cost: four `hullMaterial` instances instead of four whole models. Per-ship `light` overrides and
`applyShipLighting` go away entirely — there is one ship, and the deck's stage lights are all at zero
anyway.

---

## 9 · What gets deleted

| | |
|---|---|
| `portalGate.ts` (444 lines) + every `GATE_*` / `PORTAL_*` constant in the hook | the gates existed to hide a hard cut between two models. There is no cut. |
| `runPortalSwap`, `flyShipIntoGate`, `flyShipOutOfGate`, `parkShip`, `snapToCenter`, `replayEntrance` | the swap machinery |
| `applyShipLighting`, `shipLightLevels`, per-ship `light` | one ship |
| `hiddenParts` + the `<ship>:<mesh>` catalogue | superseded by named nodes (§5) |
| `spaceship.glb`, `spaceship3.glb`, `cargo_spaceship.glb`, `star_aventure_…glb` | ~5.15 MB |

⚠ **Removing the gates removes two point lights from the scene.** That is a program-cache-key change
(`three` keys programs on the *count* of visible lights — the trap `portalGate.update` was rewritten
around, and the one `[[three light-count relink]]` records). It is safe *here* because the count drops
to a constant decided at build rather than toggling at runtime, but the deck's warm-up diagnostic
(`added NONE`) is the check that it stayed safe, and it should be watched on the first run.

Nothing at rest gets darker: `deckTuning` has key/fill/rim/ambient all at **0**, so the hull is lit
today by the PMREM room environment and its own emissive, and the gates only ever contributed light
*during* a swap.

---

## 10 · The copy has to change

`ServicesDeck.tsx` currently says **"The Fleet"** and **"One craft at a time. Bring it online."** Both
describe the old design and would actively contradict the new one — there is no fleet and there is no
one-at-a-time. The two-`<span>` structure stays (it is what lets a 360px phone re-wrap; see the ⚠ in
the component).

Three drafts, in the house voice — *a claim, then the thing that backs it up*:

- **The Build** — "We don't sell services. We hand you the finished machine."
- **The Vessel** — "Four disciplines. One airframe. Nothing ships in pieces."
- **Assembly** — "Every discipline is a part we machine ourselves. Watch what they add up to."

The per-service `eyebrow` / `description` / `capabilities` in `deckServices.ts` all stand as written —
they describe disciplines, not hulls.

---

## 11 · Order of work

| # | | risk |
|---|---|---|
| 0 | **Spike.** OBJ→GLB whole, into the existing deck as a 5th entry. Look at it. Settle forward-axis. | **decides everything** |
| 1 | `buildVessel.mjs` — islands → clusters → named, recentred nodes → `models-src/vessel.glb` | med |
| 2 | Through `optimize:models` → `public/models/vessel.glb`. Re-weigh `SOURCE_WEIGHTS` (`deck: 0.47` is sized for 5.15 MB and becomes a lie) | low |
| 3 | `deckFrame.ts` + `vesselParts.ts` — the frame maths and the authored wave/cluster/angle table | low |
| 4 | Pin publishes services progress (`servicesAssemblyEvents.ts`) | low |
| 5 | The rig + the blend in `useServicesDeck`, ship static at `assembly = 1` first — prove the flight and the drag still work before anything moves | med |
| 6 | Assembly, travel/align/lock/kick, the swarm drift | med |
| 7 | Per-wave materials + ignition | med |
| 8 | Delete §9. Copy from §10. **Update `CLAUDE.md`** — it is wrong about this section the moment step 5 lands, and its own header says fixing it is part of the change | low |

Steps 0–5 leave a working site at every point. Nothing here touches the scroll spine, `carouselLayout`,
the works field, the chamber, or the contact finale.

---

## 12 · The one honest objection

**The loader already assembles something.** The intro holds ten shards of `fractured_sun.glb` on
screen and then locks them together into the star. Doing it again in the next section is the same verb
twice.

Kept anyway, deliberately, because the two are not the same event:

| | loader | services |
|---|---|---|
| clock | time — ~1.5 s, automatic | **scroll — you pace it, and you can reverse it** |
| span | one beat | ~40 % of the page |
| subject | jagged organic debris | machined panels |
| meaning | fusion — chaos becomes a star | **engineering — parts become a machine** |

A site whose whole identity is *gravitation and things converging* is allowed a motif, and a motif is
what this becomes: the star pulls itself together to open the site, and the vessel is built by hand to
carry you through it. What would be wrong is doing it a **third** time — so the works marks and the
chamber must stay as they are.

---

## Appendix · Awwwards scoring, per the brief's own framework

| | | |
|---|---|---|
| Creativity | 9 | services as *components of one machine* is not a layout anyone else is shipping |
| Innovation | 8 | the technique is known; binding it to scroll position reversibly is not |
| Interaction | 9 | scroll builds and un-builds it; drag grabs a part in proportion to how attached it is |
| Visual design | **?** | **the open question — §2 decides it** |
| Motion | 9 | travel → align → **lock** → kick, all off one scrubbed number |
| Technical | 9 | build-time clustering, screen-space holding ring, zero change to the scroll spine |
| Memorability | 10 | "the site built a spaceship in front of me and then flew me away in it" |
