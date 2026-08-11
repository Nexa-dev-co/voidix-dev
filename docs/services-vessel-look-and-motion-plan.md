# The Services vessel — the look, and the motion

> **Status: BUILT** (2026-08-11). Follows `services-vessel-assembly-plan.md` (built). Branch
> `feat/services-vessel-assembly`.
>
> Two complaints, one root cause each. The colours are wrong because the material was written for a
> different kind of model. The motion is thin because the travel is a straight line.

---

## PART ONE · Colour

### 1 · What the model actually is

The albedo is 512×512 and it is **almost entirely pure black with thin saturated amber lines**:

```
  ┌──────────────────────────────────┐
  │ ▁▁       ▁▁▁▁▁▁          ▔▔      │   ~97 % of the texture is #000-ish
  │                    ▁▁▁▁     ╱    │
  │        ╲▁                  ╱     │   ~3 % is 1–3 px amber trim, tracing
  │   ▪                       ╱      │   every panel seam and hard edge
  │   ▪                      ╱       │
  │              ▁▁▁▁    ╱  │        │   there is NO panel shading, NO ambient
  │      ╱▔▔▔▔╲         ╱   │        │   occlusion, NO surface variation
  │    ╱▁▁▁▁▁▁▁╲▁▁▁▁▁▁╱     ╱        │
  └──────────────────────────────────┘
```

Two consequences, and between them they are the whole complaint:

**The hull's FORM in the reference render comes entirely from LIGHTING, not from the texture.** That
render is a studio shot on a grey background — soft key, visible facet shading, grey catch on every
wing edge. Our stage has `keyMultiplier`, `fillMultiplier`, `rimMultiplier` and `ambientIntensity` all
at **0**. A black hull with no texture variation, lit by nothing, is a silhouette-shaped hole.

**And the trim is the design.** Those amber lines are not decoration on the ship, they *are* the ship's
visual identity — and they are already, exactly, `--heat-600`. The model arrived on-brand.

### 2 · Why the current material destroys it

`hullMaterial`'s graded shader was written for the old fleet: four third-party hulls that came in the
wrong colours and had to be **forced** onto a palette. This model needs the opposite — it needs
*revealing*. Three specific failures:

| what the shader does | what it does to THIS texture |
|---|---|
| maps albedo **luminance** → shadow / hull / highlight | 97 % of the texture is at luminance ~0, so the entire hull collapses onto one flat `shadow` tone. Nothing is left to grade. |
| picks out emissive where `luminance > emitThreshold` (0.84) | the amber trim sits at luminance **≈0.63** (`#ff8a1a` in sRGB — and **0.45** in the linear space the shader actually sees, since `<map_fragment>` has already decoded). It never crosses 0.84 in either, **so the trim does not glow at all.** |
| the trim's luminance lands mid-scale, so the grade… | …maps it between `hull` and `highlight` — i.e. **the amber lines come out GREY.** The single best feature of the model is being converted to the thing it is supposed to stand out from. |

That is the bug in one line: **a luminance threshold cannot tell a bright grey panel from an amber
line, and this texture is nothing but black and amber lines.**

### 3 · The fix — separate by SATURATION, because the texture is a perfect binary

```
                    saturation
        0.0 ─────────────────────────────► 1.0
        │                                  │
    ████████ hull (black, desaturated)     │
        │                                  ▓▓▓▓ trim (amber, saturated)
        │                                  │
        └──────── one clean cut ───────────┘
```

`sat = (max(rgb) − min(rgb)) / max(rgb)` — three instructions, and it separates this texture perfectly
at any brightness. Replace the luminance grade with:

1. **`trimMask = smoothstep(TRIM_SAT_LOW, TRIM_SAT_HIGH, saturation)`** — 0 on the hull, 1 on the trim.
2. **Hull** = a constant dark metal base (not the texture's black — see §4), shaded by real lighting.
3. **Trim** = the wave's accent colour at full emissive, modulated by the texture's own luminance so
   the lines keep their internal falloff and taper.

The texture stops being a colour source and becomes what it actually is: **a trim mask.** Which is
also why the per-wave accent gets *better* — the trim colour is now entirely ours, so each wave's parts
glow their own discipline's colour **along the same circuitry**. One machine, four circuit colours,
and the model's own design language carries it.

⚠ **This is also why the texture must stay WebP, not ETC1S.** `optimizeModels.mjs` encodes to WebP and
CLAUDE.md's "every texture is KTX2/ETC1S" note describes the *other* road (`buildModels.mjs`). Keep it
that way here and write down why: ETC1S stores a per-4×4-block base colour plus luminance modulation,
and every block along a 2 px saturated line against pure black is exactly the case it averages into
mud. The trim IS the model; 512² × RGBA is 1 MB of VRAM on the cheapest scene on the site.

### 4 · Lighting — a black ship needs an edge

Pure black is right for the reference's grey backdrop and wrong for our black stage. Three changes,
all small:

- **Hull base lifts off pure black** to `#0e1116` — enough that facets differ from the void behind
  them, still unmistakably a black ship.
- **The rim light comes ON, and it is the sun.** `rimMultiplier` goes 0 → 1, positioned *behind and
  above* in `--heat-600`. ⚠ This does not contradict the "every stage light is 0" doctrine in
  `deckTuning` — it **implements** it. The doctrine says *"the cracked sun behind it is the only light
  in the scene"*, but the sun is a DOM layer behind the canvas and casts no actual light, so until now
  the sentence described an intention rather than a rig. A back-rim in the sun's colour and position is
  the honest realisation of it. Key and fill stay at 0.
- **The fresnel rim in the shader strengthens** (`RIM_STRENGTH` 0.6 → 0.9, `RIM_POWER` 3.0 → 2.4), so
  every silhouette edge catches. This is what makes a black object read on black.

### 5 · Bloom — turn it on, and this time it is correct

`BLOOM_ENABLED` has been `false` since 2026-07-28, and the reason recorded is real:

> *"with every stage light at 0 the ships are lit only by the cracked sun behind them, and blooming
> their accents on top of that read as haze rather than as glowing engines."*

That was a judgement about **broad** accents on four hulls. This ship's emissive is **thin lines**,
which is the one thing bloom is unambiguously good at, and the threshold does the discriminating:
`BLOOM_THRESHOLD` at 1.0 with a near-black hull means **nothing but the trim can cross it.** Haze
requires a large area over the threshold and there isn't one.

⚠ It is still the most expensive pass on the site and it is a real cost — but the deck is now the
*cheapest* scene (9 draw calls, 1,980 triangles, one 30 KB model), which is precisely the headroom that
did not exist when this was switched off. If it reads as haze, put it back to `false`; the constant is
still one line.

### 6 · The four waves, restated as circuitry

| wave | trim colour | was | why |
|---|---|---|---|
| 1 · Web | `--heat-600` `#ff8a1a` | `#a82600` | the model's own amber. Wave 1 is the frame — it should look like the ship the reference render shows, untouched. |
| 2 · Mobile | `--slate-800` `#dfe7ff` | `#cfe0f5` | the cool counterweight, now on the ramp's own cool axis rather than near it |
| 3 · Enterprise | `--heat-800` `#ffb24d` | unchanged | the hot end of the ramp; these are the engines |
| 4 · AI | `#7a4ad0` → `#36e6ff` | unchanged | **the licensed alien, unchanged.** It is the brain, it arrives last, and at ignition its colour floods every other wave's circuitry. |

⚠ Wave 1 moving from `#a82600` (heat-300) to `#ff8a1a` (heat-600) is deliberate: heat-300 was chosen
when the trim was a *paint* colour on a hull. As **light** it has to clear the ramp's type floor logic
by the same reasoning — heat-300 emitting on black reads as dried blood, not as a live circuit.

---

## PART TWO · Motion

### 7 · What is actually wrong

The assembly plan promised *"a curved approach, not a straight line: the part swings wide, keeping its
tumble, decelerating."* The build ships:

```ts
member.group.position.copy(member.holding).add(driftOffset).lerp(targetPosition, blend);
```

**That is a straight line.** Everything else — the travel/align/lock shaping, the overshoot, the flash —
is riding on a linear path, and a linear path is what makes assembly animation look cheap. This is a
gap between the plan and the build, not a tuning problem.

Four more, smaller:

- **The tumble is constant-rate about one fixed axis.** Constant angular velocity is the least organic
  motion there is; it reads as a spinning prop, not as debris.
- **The drift is one-dimensional** — a bob in and out along the ring radius. It pulses; it does not
  wander.
- **Nothing anticipates.** Parts start moving at full commitment.
- **Ignition is a uniform fade** over every part at once.

### 8 · The travel becomes a cubic Bézier — and that buys two things at once

```
        holding ●━━━━━━━━━━━━━━━━━━━━━━━━━━━━●  socket        BEFORE: a lerp
                        (straight)

                 ╭─────────────╮                              AFTER: P0 → P3 cubic
        holding ●╯             ╰──╮                           
                 ↑                 ╲                          P1 = holding + swingTangent
              P1 │ swings along     ╰──●━━━━►● socket         P2 = socket + approachAxis · d
                 │ the ring          P2      P3
                                     └── final approach runs ALONG the
                                         part's own mounting axis
```

**P1 (the swing)** is tangential to the holding ring, not outward — so a part *sweeps around* into
frame instead of diving at the centre. It is derived from the holding position rather than authored, so
it stays correct at every aspect ratio for free. A `swing` sign per part makes mirror pairs sweep
symmetrically.

**P2 (the approach axis) is the important one.** The last stretch of travel runs along the direction the
part actually mounts from — a wing slides *inboard* along ±x, the nacelles come *down* onto the body,
the core slots *forward* like a cartridge. This is the difference between a part **arriving at** its
position and a part **fitting into** it, and it is the single biggest upgrade to the "it is being
assembled" read.

| cluster | approaches from | reads as |
|---|---|---|
| `w1_spine` | below, slightly aft | a keel laid on a slipway |
| `w1_body_*` | ±x, level | plates closing onto the spine |
| `w2_wing_*` | ±x, outboard → inboard | wings sliding onto their mounts |
| `w3_engine_*` | above, slightly outboard | nacelles lowered onto the body |
| `w4_core_*` | aft, along +z | a cartridge slotting home |

Guarantees preserved: P0 = holding and P3 = socket exactly, so blend 0 and blend 1 are unchanged and
the whole thing is still a pure function of one scrubbed number. Cost is ~9 vector lerps for 9 parts.

### 9 · The other four

**Anticipation.** A wind-up over the first ~12 % of travel: the part eases *away* from its socket by a
small distance, then commits. Implemented as an additive offset with `sin(π·t/A)` shaping — exactly 0
at both ends, so it cannot disturb the endpoints or the reversal.

**Compound tumble.** Two rotations about two axes at incommensurate rates (ratio ≈ φ), multiplied. Real
tumbling debris precesses; one axis at constant rate does not. It never visibly repeats, and it costs
one extra quaternion. The tumble also **slows as the part commits** — it is under control now, not
adrift.

**Lissajous drift.** Three independent sines at coprime-ish frequencies on x/y/z instead of one radial
bob, so each part wanders a small 3-D figure. Amplitude scales with the part's depth so the far parts
move less, which reads as distance.

**A per-part settle.** After contact, a damped oscillation **along the approach axis** — two or three
cycles, decaying, a few percent of the part's size. The whole-body `kick` already exists and stays;
this is the part's own clunk as it seats. Driven off progress past the wave's end, exactly like the
kick, so it stays reversible.

### 9b · How long a part takes to fly — and where that is actually set

⚠ **Not in this file, and not in the smoothing.** A first pass at "make the travel 50 % longer" moved
`ASSEMBLY_SMOOTHING` from 0.12 to 0.08, on the reasoning that the scrub target is a step function and
the deck's ease is therefore the whole duration. That reasoning is wrong: `useHeroAnimation` pins with
`scrub: 1.8`, so **pin progress already takes ~1.8 s to walk from one stop to the next** and the deck's
ease (~0.6 s) is a lag on a motion that is mostly over. The change bought nearer 10 % than 50 %.

```
  wheel  ──►  scrollTo tween  ──►  ScrollTrigger scrub  ──►  deck ease  ──►  parts
            (0.6 s)                (1.8 s)  ◄─ dominates      (0.6 s)
```

So the follow is **speed-capped** instead: `waveSpan ÷ ASSEMBLY_WAVE_TRAVEL_SECONDS` progress per second,
with the exponential ease taking over for the last ~6 % as a soft landing. A wave now takes at least
that long **whatever the scroll did and however the pin's scrub is tuned** — which is the property the
plain ease could never have, since its duration was a function of a constant in another file.

Two escapes, both necessary: the cap lifts once the backlog exceeds `ASSEMBLY_CATCHUP_WAVES` (a navbar
jump is not a wave being built, and capped it would take fifteen seconds to reconcile), and the frame
delta feeding it is clamped, because this loop's timer is unclamped and a tab-restore would otherwise
authorise one unbounded step.

⚠ 3.6 s is deliberately longer than `STAGE_STEP_HOLD_MS` (2,900 ms), so a wave can still be seating when
the next step is allowed. That is fine here and would not have been for the portal swap this replaced:
overlapping waves is what an assembly looks like, and every part is a pure function of progress, so an
interrupted wave cannot land wrong — it simply keeps going.

### 10 · Ignition becomes a travelling wave

Currently every part lights at once on a smoothstep. Instead: **the light starts at the core and runs
outward along the hull**, each part delayed by its socket's distance from the ship's centre.

```
  progress 0.93 ────────────────────────────────► 1.0
      core          body          wings         wingtips
       ⚡    →        ⚡⚡     →     ⚡⚡⚡⚡   →    ⚡⚡⚡⚡⚡⚡
      w4            w1            w2/w3          outboard

  the AI wave locks ── and the machine comes alive from the brain outward
```

Wave 4 is 83 triangles a side; it was never going to carry the finale on geometry. This is what it
carries it on, and it makes the narrative literal: **the intelligence arrives last, and the intelligence
is what switches the machine on.** Cost is one per-part delay computed once at load.

---

## 11 · Order of work

| # | | risk |
|---|---|---|
| 1 | `hullMaterial` — saturation trim mask, hull base, stronger fresnel | med |
| 2 | `deckServices` — profiles become hull + trim, four circuit colours | low |
| 3 | `deckTuning` + the hook — rim light on in the sun's colour, bloom on | low |
| 4 | `vesselParts` — `approachAxis`, `swing`, second tumble axis, drift frequencies | low |
| 5 | `vesselAssembly` — Bézier, anticipation, compound tumble, Lissajous, settle | med |
| 6 | Travelling ignition | low |
| 7 | `CLAUDE.md` — the vessel section's colour + lighting claims | low |

## 12 · Still unresolved, and still needs eyes

**Which end is the nose.** `VESSEL_MODEL_ROTATION` is `{0,0,0}`. The reference render is shot down the
z axis and shows the two nacelles capped by dark slotted grilles — which read as **exhausts**, putting
the nose at **+z**. That is evidence, not proof, and the flight steers by `HEADING_PHASE`, so a wrong
answer flies the ship to Works tail-first. One line in `deckServices.ts` flips it: `{ x: 0, y: 180,
z: 0 }`.
