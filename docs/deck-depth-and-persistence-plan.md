# Two plans: making the fleet read as solid, and what a cookie is actually for

> **Status: PROPOSED**, 2026-08-10, on `feature/services-particle-ship`. Nothing here is built.
> Part A follows on from `services-particle-ship-plan.md` §10 (*"nobody has watched it"*); Part B
> follows on from the question `lib/cacheTelemetry.ts` was written to answer and has not yet been
> asked on a preview.

Two unrelated asks, kept in one file because they were asked together. They share no code. Read
whichever half you are working on.

---

# PART A — The Services craft: making a drawing read as a 3D model

## A0 · First, what "the SVGs" are — because it changes the whole answer

`deck-shapes-src/01-web.svg` … `04-ai.svg` are **not the source of anything on screen**. They are a
readable *record* written by `buildFleetDrawings.mjs` alongside the binary, so a human can open a
craft and judge the extraction angle. Re-drawing one by hand moves zero grains.

What the visitor actually sees is `public/deck-drawings.bin` — four 3D point clouds — sampled into
`createFleetDrawing`'s grains and flattened per-frame by one dot product. So:

```
   deck-shapes-src/*.svg  ──►  a human's eyes          (the record — inert)
   public/deck-drawings.bin ──►  the GPU               (the craft — everything below)
```

**Everything in Part A changes the bake and the shader.** If the SVG records themselves also want to
look dimensional, that is one small separate change and it is §A8.

---

## A1 · Why they read flat right now

Five reasons, all visible in the code, ranked by how much each one costs:

```
              THE CRAFT, SEEN FROM THE SIDE          what the eye is given
   camera                                            ─────────────────────
     ◄── ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
         ░  near hull      far hull  ░               near + far, SUMMED
         ░   ● ● ● ●   ▒▒▒▒   ● ● ●  ░               every back-face grain
         ░     ╲  additive, depthWrite:false         shines through the front
         ░      ╲───────────────────►                → no silhouette, no solid
```

| # | what is missing | where | why it flattens |
|---|---|---|---|
| 1 | **occlusion** | `fleetDrawing.ts` — `depthWrite: false`, `AdditiveBlending` | A solid object hides its own back. This one sums it through the front, so the densest passage on screen is wherever *two* faces overlap — which is the exact opposite of how a hull shades. |
| 2 | **surface** | `buildFleetDrawings.mjs` — `samplePoints` walks **segments** | The points come only from feature edges. Feature edges *are* a line drawing. There is nothing between the lines for the eye to read as a face. |
| 3 | **shape-carrying shading** | `GRAIN_VERTEX_SHADER` — `vHeat` | The only cues are a linear depth ramp and perspective point size. Both are monotonic in depth, so both are the same on a sphere, a cone and a flat plate at the same distance. They say *how far*, never *which way the surface is pointing*. |
| 4 | **any light at all** | `deckTuning.ts` — every multiplier is `0` | Deliberate: the deck is lit only by the cracked sun behind it. But the dust carries no normal, so it cannot be lit *by* that sun even in principle — it is the one thing on the stage that ignores the stage's only light. |
| 5 | **ground contact** | landing pad removed 2026-07-29 | Nothing anchors the craft to a place. A floating object is read as an image; an object that occludes something reads as a thing. |

The single missing datum behind 1, 3 and 4 is the same: **a normal per point**. That is why the plan
below is one bake change with four separate payoffs, not four changes.

---

## A2 · The ranked fixes

| | fix | bake bytes | frame cost | how much it buys |
|---|---|---|---|---|
| **A3** | normal per point → **back-face fade** | +32 KB | ~2 shader lines | ●●●●● the silhouette closes |
| **A4** | …the same normal → **rim from the sun** | 0 (reuses A3) | ~4 lines | ●●●●○ backlit read, ties to the site's one light |
| **A5** | **depth-of-field** in the sprite | 0 | ~3 lines | ●●●○○ free, strong monocular cue |
| **A6** | **baked AO** per point | +16 KB | 1 attribute read | ●●●●○ crevices darken → volume |
| **A7** | **contact shadow** on the pad | 0 | 1 draw call | ●●●○○ "landed" comes back |
| **A9** | **surface points**, not only edges | 0 (same count) | 1 attribute | ●●●●● the deepest change, and the riskiest |

Do them in that order. A3+A4 are one commit; everything after it is independent.

---

## A3 · Bake a normal per point, and fade the back face

**The bake.** `readWorldTriangles` already returns world triangles, so a face normal is a cross
product and costs nothing. `samplePoints` picks a point on a *segment*; give each segment the mean
normal of the two faces that produced it (`shipFeatureEdges.mjs` already has both, that is how it
classifies a crease) and carry it through the same `intoCanonical` change of basis the positions get.

⚠ **Through the same basis, or the normals belong to a different craft than the points.** This is
trap §8.2 of the fleet plan (the mirrored drawing) waiting to happen again in a form that is much
harder to see.

Store **oct-encoded, 2 × int8 per point** — 2 bytes against the position's 6, so the file goes
164 KB → ~197 KB. Bump `BINARY_VERSION` to 3; `deckDrawings.ts` already rejects a version mismatch
and returns `null`, so a stale cached `.bin` fails closed rather than being read as coordinates.

**The shader.** Four more attributes (one normal per craft), morphed by the *same* one-hot selectors
the positions use — never a separate blend, or a grain's normal will belong to a craft its position
has already left. Attribute budget: 5 today → 9, against a guaranteed 16.

```glsl
  vec3 normal = normalize(mix(leavingNormal, enteringNormal, morph));
  float facing = dot(normalize(normalMatrix * normal), normalize(-view.xyz));

  // A back-facing grain is INSIDE the craft. It still exists — this is dust, not a closed hull —
  // but it must not add its full brightness through the front, or the near face and the far face
  // are indistinguishable and the object has no silhouette.
  float solidity = mix(BACKFACE_FLOOR, 1.0, smoothstep(-0.15, 0.25, facing));
```

⚠ **`BACKFACE_FLOOR` is not 0.** At zero the craft becomes a shell and the turn reads as a paper
model folding — the interior emptiness is visible through the sparse near face. ~0.2 keeps a hint of
the far side, which is what dust should do.

⚠ **Neutralise it while flat.** A drawing has no front or back — `mix(1.0, solidity, uTurn)` — or the
plan view arrives already half-shaded and the turn has nothing left to reveal. **The turn becoming
the moment the craft acquires a front is the entire point of this change.**

---

## A4 · Rim light, from the only light on the stage

`deckTuning`'s comment is load-bearing: *"Every stage light is OFF, on purpose. The deck is no longer
lit by a rig — the cracked sun behind it is the only light in the scene."* The sun sits **behind** the
deck. A backlit object is read almost entirely from its rim.

So once A3 has normals, the correct shading model is free and is not a guess:

```glsl
  float rim = pow(1.0 - abs(facing), RIM_SHARPNESS);         // edges hot, middle dark
  float toSun = max(0.0, dot(normal, uSunDirection));        // and hotter on the sun's side
  vHeat = clamp(vHeat + rim * RIM_GAIN * mix(0.35, 1.0, toSun), 0.0, 1.0);
```

`uSunDirection` is the deck's own view direction toward the star, pushed per frame like
`buildAxis`/`buildOrigin` already are. Same treatment as the wireframe's `uDorsal`: one uniform, one
owner.

This is also the argument for doing A3 at all in design terms rather than technical ones — it makes
the fleet **the same scene as the sun**, instead of a particle system playing in front of it.

---

## A5 · Depth of field, for nothing

`view.z - centreView.z` is already computed for `vHeat`. Two more uses of it:

```glsl
  float defocus = abs(view.z - centreView.z) * DEFOCUS_SCALE;
  gl_PointSize *= 1.0 + defocus;      // out-of-focus grains bloom wider
  vAlpha /= 1.0 + defocus * 1.6;      // …and dimmer, so total energy is roughly preserved
```

Bokeh is one of the strongest monocular depth cues there is and this costs two multiplies. ⚠ Divide
the alpha as well as widening — widening alone makes the far side *brighter*, which is defect §8.3
(heat graded backwards) arriving through a different door.

---

## A6 · Baked ambient occlusion — one byte per point

For each sampled point, fire ~32 cosine-weighted rays against the craft's own triangle soup and store
the open fraction as a `uint8`. 4 096 × 4 craft = 16 KB. Bake-time only; with a simple grid
acceleration it is seconds per craft.

Multiply into `vAlpha` and pull `vHeat` down with it. This is the cue that separates *a cloud shaped
like a ship* from *a ship*: the inside of an intake goes dark, a wing tip stays bright, and the eye
infers the enclosing volume it cannot see.

⚠ Like the normal, it must fade out toward the flat drawing — a plan view with baked shadows in it is
a rendering, and the drawing is supposed to be a **drawing**.

---

## A7 · Give it a floor to stand on

The landing pad was removed 2026-07-29 *because its light washed out the sun*. So the replacement is
not a light — it is an **occluder**: one additive-black or very low-alpha radial quad on `y = 0`,
sized from the craft's projected extent, faded by `presence * turn`.

```
        ◣██◢          the craft
     ────░░░░────     a soft dark pool, widest under the hull's mass
```

Cheap, one draw call, and it restores `cameraLookY`'s whole purpose (*"what makes the craft read as
landed rather than floating"*) to the three stops that no longer have a hull.

---

## A8 · If the SVG records should look dimensional too

Separate, small, and touches nothing the visitor sees. `buildFleetDrawings.mjs` writes every segment
as one flat black `M…L…` at a fixed 1.6 stroke. It already has each endpoint's depth along the plan
basis's `forward` axis. Emitting segments **depth-sorted**, with `stroke-opacity` and `stroke-width`
graded by depth, turns each record into something a human can read the form from at a glance — which
is the only job those files have.

Do not let this drift into a second authoring surface. It is a debug render.

---

## A9 · The deep one: sample surfaces, not only edges

Everything above makes a **line drawing** shade like a solid. This makes it *be* one.

Change `samplePoints` to spend a fraction of its budget — start at 35 % — on **triangle area** rather
than segment length, tagging each point with `aIsSurface`. The point count per craft does not move,
so nothing downstream changes.

The payoff is that the turn can do something it currently cannot:

```
   flat  ──────────────────────────────►  turned
   ╭───────────────╮                      ╭───────────────╮
   │   only the    │                      │  edges AND    │
   │   EDGE points │   surface points     │  surface —    │
   │   are visible │   fade IN with uTurn │  a solid      │
   ╰───────────────╯                      ╰───────────────╯
      a drawing                              a model
```

The craft **fills in as it turns**. That is the section's own stated idea — *a machine drawing a
ship, then building it* — extended to the three stops that never get a hull.

⚠ **Risks, all real:**
- The flat drawing must stay a drawing. Gate surface points on `uTurn` hard, not softly.
- Area-weighted sampling on the hauler (`03`, 6 842 segments and by far the busiest) may read as
  fog. Check the point-cloud PNG previews the bake already writes before trusting the shader.
- The scan-order sort (`b.drawY - a.drawY`) must be applied **after** the two sets are merged, or
  grains will travel between an edge point on one craft and a surface point on the next. The sort is
  what makes tops travel to tops; §4 of the fleet plan says why it is load-bearing.

---

## A10 · What NOT to do

- ⚠ **Do not sample the SVGs.** They are the record; the grains would have no 3D home. (CLAUDE.md.)
- ⚠ **Do not enable the deck's `UnrealBloomPass`.** It ships `enabled = false` and a strength-0 pass
  costs the whole blur pyramid. The glow belongs in the sprite. If the craft read flat, the cause is
  in this document, not in the composer.
- ⚠ **Do not turn the stage lights back up.** `deckTuning`'s zeros are the reason the sun reads as
  the light source. A4 is how the fleet gets lit without them.
- ⚠ **Do not raise the grain count to fake solidity.** §10 already flags 7k–26k as sized by argument
  rather than measurement. More grains at the same flatness is haze, not volume — and it is the one
  change here that costs frame time linearly.
- ⚠ **Do not switch off additive blending.** The additive field *is* the look. A3 works by modulating
  per-grain alpha, which keeps it.

---
---

# PART B — Cookies: what they can and cannot buy here

## B0 · The honest framing

**A cookie does not make a GPU faster.** It can do exactly two things this site cares about:

1. **Tell the server something before the first byte of HTML.** Nothing else can — not
   `localStorage`, not `sessionStorage`, not a query string a visitor never typed.
2. **Carry a measurement across visits**, so work already done once is not redone.

For (2), a cookie is the **wrong** tool: it is capped near 4 KB and it is uploaded on *every*
same-origin request. `localStorage` is 5 MB, costs nothing per request, and `lib/motionPreference.ts`
already establishes the exact pattern to copy — including the part that matters most, which is
**expiring a stored value when the world it was recorded in moves under it**.

So the plan is split by *who reads it*:

```
   ┌──────────────────────────────────────────────────────────────────────────┐
   │  COOKIE  (≤64 bytes, server-readable)   │  LOCALSTORAGE (client only)    │
   │  ───────────────────────────────────    │  ────────────────────────────  │
   │  · device tier, latched                 │  · the burn-in's solved ratios │
   │  · "wants the lite/document version"    │  · field ms / star ms          │
   │  · reduced-motion resolution            │  · the MSAA licence            │
   │                                          │  · the preconditions block     │
   │  read in the root layout, decides        │  read at allocation time,      │
   │  <head> preloads and <html data-*>       │  verified, then overridden     │
   └──────────────────────────────────────────────────────────────────────────┘
```

---

## B1 · The measurement record (localStorage) — the real quality win

Every single load, behind the veil, this site measures itself from scratch: `gpuProbe` times one
frame, the burn-in runs up to 1.5 s, `reportSectionCosts` solves the field/star split, and
`reportBurnIn` decides whether 4× MSAA is affordable. `[pixels] ALLOCATED` is the output.

That is measured, thrown away at unload, and measured again on the next visit.

**Persist it and a returning visitor's *first* lap gets what the first lap earned last time.** Two
concrete payoffs:

- **MSAA stops being a mid-session reallocation.** CLAUDE.md records that raising works·space to 4
  was *"a mid-session `dispose()` and reallocation of both ping-pong targets on the first lap and
  never again"*. With a stored licence it is an allocation-time constant, and the visitor never sees
  the buffers swap.
- **A hostile load stops costing quality.** The burn-in has been measured returning *"0 usable frames
  in 2545 ms"* and *"0 in 15786 ms"* — 15 long tasks totalling 4.7 s ran through it. A stored reading
  is the honest fallback for exactly that case, and it is strictly better than the conservative
  default the loader falls back to today.

### ⚠ The rules that make it safe

1. **A stored value is a STARTING POINT, never authority.** The probe still runs, the burn-in still
   runs, the live controller still runs, and any of them may override. This is not a return to
   guessing upward — the value was *measured on this machine*, which is the thing
   `adaptivePixelRatio`'s header says a guess is not — but it is still verified.
2. **Apply it only before the first visible frame.** Reallocating a composer mid-session is a visible
   jump; that is why the ratio is frozen during crossings. A record that arrives late is discarded,
   not applied.
3. **It expires when its preconditions move.** Record them alongside, and void the whole record if
   any differ:

   | precondition | why |
   |---|---|
   | `devicePixelRatio` | an external 4K monitor is a different machine |
   | viewport bucket | so is a maximised window |
   | `deviceMemory`, `hardwareConcurrency` | a different browser profile or device entirely |
   | `saveData` | an instruction, not a hint — it must win |
   | build id | new shaders, new bake, new costs |

   ⚠ **And it must not survive a plug being pulled.** A laptop on battery throttles hard, and there
   is no signal for it. Mitigation: store an **expiry of days, not months**, and never let a stored
   value raise quality by more than one step above the unstored default in a single visit.
4. **It may never decide geometry.** Ratios and sample counts, yes. Which model downloads, no —
   that belongs to `deviceTier`, which is latched at first ask for its own documented reasons.

---

## B2 · The cookie proper — what only the server can act on

One cookie, short keys, ≤64 bytes:

```
   vx=1.t4.m1.l0        version . tier . motion . lite
   Path=/  SameSite=Lax  Secure  Max-Age=15552000  (no HttpOnly — the client writes it)
```

Read it in the root layout (`cookies()` from `next/headers`) or in a `middleware.ts`, which does not
exist yet. Three uses, best first:

**1 · Stop spending 2.1 MB on visitors who will not use it.** `app/layout.tsx` preloads
`fractured_sun.glb` + Draco WASM + Basis WASM on **every route**, and CLAUDE.md already flags this as
a known, deferred cost (`docs/about-careers-plan.md` §1e). The route half of that fix needs no
cookie. The **tier** half does: the server cannot know `deviceMemory`, `dpr` or `saveData`, and a
returning `potato`/`saveData` visitor is one the Basis transcoder's 527 KB serves worst. This is the
single largest byte saving available anywhere in Part B, and it costs nothing visually on a device
that was already going to be `potato`.

⚠ Reading cookies opts the route into **dynamic rendering**. On a site that is one static HTML shell
plus 5.7 MB of assets, the trade is fine — but it is a trade, and it should be stated in the commit
rather than discovered.

**2 · Stamp `<html data-tier="…" data-motion="…">` server-side.** `motionPreference` already paints
`data-motion` *after* mount. Painting it in the HTML removes the window where CSS has the wrong
answer, and lets `SkipToLite` render already-offered instead of appearing a beat later.

**3 · Honour a lite choice before the loader mounts.** Someone who took the document version once
should not sit through the gather again to be offered it a second time.

---

## B3 · The intro — the tempting one, and why it goes last

"They have seen it, skip it" is the obvious idea and it is the riskiest thing in this document.

⚠ **Contract 1 and Contract 2 are absolute.** `IntroSequence` releases the scroll lock **exactly
once**, in the timeline's `onComplete`, and the hero pin is created **only** inside the `REVEAL_EVENT`
handler. Any short-circuit must still travel both of those paths, or a returning visitor gets a
locked page or an unpinned one.

⚠ And the premise is probably false. The loader is gated on **real asset progress**, not a timer, so
on a warm cache it is already short. Skipping it saves the *authored* beats, not the download.

**Recommendation: do not skip it.** Use the cookie to shorten the authored holds — the shard wait, the
ignite beat — for a visitor who has completed the sequence before, leaving the asset gate and both
contracts untouched. Build it last, behind everything else here.

---

## B4 · What must never be stored

Per-frame values (`hologramPose`, `sunParallaxPose`), section progress, anything the pin owns, and
anything identifying. If it changes 60 times a second or names a person, it does not go in a store.

---

## B5 · The size budget, which is a real cost

A cookie is uploaded on **every same-origin request** — `/_next/static/*`, all four GLBs, every KTX2
texture, both `.bin` files. At ~60 requests a load, 400 bytes of cookie is ~24 KB **uploaded**, on the
scarce direction of a mobile link, to carry a number that could have lived in `localStorage`.

Hence ≤64 bytes and one cookie. ⚠ If the assets ever move to a CDN subdomain, the cookie stops riding
along with them entirely and this constraint disappears — worth knowing before it is designed around.

---

## B6 · Consent, stated plainly

ePrivacy/PECR governs **storing information on a visitor's device**, not the mechanism. So
`localStorage` carries the same obligation a cookie does; swapping one for the other is a size and
server-visibility decision, never a legal dodge.

A record of *this device's measured frame cost*, used to render the thing the visitor asked for, is a
defensible "strictly necessary". A "you have seen the intro" flag is not, and it is also the least
valuable item here — one more reason B3 goes last. Whatever ships should be described in the legal
route that `contactContent.ts` already stubs out.

---

## B7 · ⚠ The thing that is not a cookie and beats everything above

**Before implementing any of Part B, read `lib/cacheTelemetry.ts`'s verdict on a Vercel preview.** It
exists precisely to answer whether lap 2 is fast *because assets came from cache* or *because there
was nothing left to do* — and if it says the latter, caching is not the lever and this whole half of
the document is aimed at the wrong target. Do not read it in development; the immutable headers are
production-only, by design.

And there is a concrete gap it will show. `next.config.mjs` gives a year of `immutable` to `/models`,
`/textures`, `/draco` and `/basis`. It does **not** cover:

| file | size | when it is wanted |
|---|---|---|
| `/deck-drawings.bin` | **161 KB** | the entire fleet — three of the four Services stops |
| `/loader-shapes.bin` | **64 KB** | on the **loader's** critical path |
| `/fonts/helvetiker_bold.typeface.json` | **62 KB** | the works marks |

~287 KB paying a conditional round trip on every load, on a site whose loader gate waits on the
download. Two more `source` entries fix it.

⚠ **With the same caveat the file already carries, and it bites harder here:** re-running
`npm run build:drawings` under the same filename will not reach anyone who has already loaded the
site. Models change rarely; the bake changes whenever Part A touches it. **So the drawings want a
content hash in the filename**, emitted by the bake into `deckDrawingsManifest.ts` — which already
exports `DECK_DRAWINGS_URL` and is already generated, so nothing but the bake script needs to know.

---

## Order of work

```
   PART A                                  PART B
   ──────                                  ──────
   1. A3 normals + back-face fade  ┐       1. B7 cache headers + hashed .bin   ← do this first
   2. A4 rim from the sun          ┘ one   2. B7 read cacheTelemetry's verdict ← before anything else
   3. A5 depth of field              commit 3. B1 measurement record (localStorage)
   4. A6 baked AO                          4. B2 the cookie + preload gating
   5. A7 contact shadow                    5. B3 the intro          ← last, or never
   6. A9 surface points  ← the big one
```

Part B item 1 is the only thing in this document that is unambiguously worth doing before anyone has
watched the section run, because it is measured, small, and independent of every aesthetic question
Part A opens.

## What this document does not decide

- **Whether the craft actually read flat.** §10 of the fleet plan says nobody has watched the section
  yet. Part A is a diagnosis from the code, and it should be checked against eyes on a screen before
  32 KB goes into the bake.
- **Any number in Part A.** `BACKFACE_FLOOR`, `RIM_SHARPNESS`, `DEFOCUS_SCALE`, the AO ray count and
  the 35 % surface split are all first estimates, exactly as the fleet's own constants were.
- **Whether a consent banner is required.** That is a decision about jurisdiction and appetite, not a
  technical one.
