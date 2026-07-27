# Sun Lab — remaining work

Snapshot taken 2026-07-27, after the black-hole raw-model restoration, the lensing pass and the accretion
spiral all landed. Written to be picked up cold: each item says what, why, and where.

Background docs:
- `docs/black-hole-raw-model-plan.md` — the model conversion, the specular trap, the dead-control fixes
- `docs/sun-to-blackhole-finale-plan.md` — the five-phase finale design (§3) and the fluid-spiral scope (§8)

---

## Already done (so nobody redoes it)

| | where |
|---|---|
| `black_hole.glb` converted spec/gloss → metallic-roughness at build time, 30 MB → 2.87 MB | `scripts/optimizeModels.mjs` (`specGloss` recipe) |
| ~70 lines of runtime material rewriting deleted; the model loads its own colours + textures | `useSunLabScene.ts` |
| Event horizon made genuinely unlightable (`specularIntensity = 0`) | `BLACK_HOLE_HORIZON_MATERIALS` |
| Dead HUD controls fixed (group reset / show-hide / shared-material reset routed to the active registry) | `SunLab.tsx` `activeSceneRegistry()` |
| Sun no longer written to the black hole's materials; standalone hides the sun properly; Fit camera on the BH tab | `SunLab.tsx`, `useSunLabScene.ts` |
| New material controls: `specularIntensity`, `blending`, `depthWrite` | `sunLabState.ts`, `sunLabModel.ts`, `hud/controls.tsx` |
| Screen-space lensing pass (refraction + chromatic aberration + photon ring) | `lensingShader.ts` |
| Accretion spiral, 120k particles seeded from the sun's mesh, wound by Keplerian shear | `accretionShader.ts` |
| Sun implosion re-curved to accelerate (cubed, was smoothstep) | `applyFinale` |
| Play/scrub desync bug fixed (Play now reports each step back to React) | `playSequence(duration, onSequence)` |

Committed through `53c3f18`. **The lensing + spiral work is still uncommitted** — see §3.

---

## 1. Finale beats still unbuilt

Design and rationale: `docs/sun-to-blackhole-finale-plan.md` §3. Ordered by how much each one buys.

### 1.1 THE FLASH — highest value remaining

The sun still visibly fades out. The plan has its scale reach zero **exactly at a supernova flash peak**,
so the handoff is hidden inside the glare and you never watch it shrink to nothing.

```
        0.42      0.47       0.58
          │  FLASH  ▲          │
  sun ────╲_________0          │     scale hits 0 AT the peak
  flash    ______╱▔╲_____      │     fast attack, slower decay
  horizon        ____╱▔▔▔▔▔▔▔▔▔      resolves out of the glare
```

Mechanics: an asymmetric pulse on `renderer.toneMappingExposure` and `bloomPass.strength`, plus retiming
the sun's collapse curve to land on the peak. Small change, and it removes the last of the cross-fade.

New param: `finaleFlash` (default ~0.8), and `finaleFlashAt` (~0.47) to shift where the handoff lands.

### 1.2 The shards don't participate in the collapse

`fractureSpread` already moves the ten shards radially, and negative values collapse them — the Collapse
preset sits at `−0.5`. **`applyFinale` still never touches it.** The most natural collapse motion in the
project is sitting unused while the sun is uniformly scaled instead.

Drive it on the same accelerating curve as the implosion. Watch out: the render loop's breathing branch
(`fracturePulse !== 0`) writes shard positions every frame and would fight it — the finale must take
priority while it is driving. Singularity has `fracturePulse: 0`, so this is a guard, not a live conflict.

New param: `finaleShardCollapse` (~1.2, in cell-radius units).

### 1.3 Gravitational redshift

Light climbing out of a deepening gravity well reddens. The magma stays white for the whole collapse.
White-hot → amber → deep red → gone is cheap and is the cue that reads most as real physics.

Implementation note: the finale must remember what to tint *from*. Capture the authored emissive when
`applyGlobal` / `applySharedMaterial` writes it, then lerp from that captured base, so `sequence 0`
restores exactly and a mid-finale material edit re-captures. Gate behind a toggle.

New param: `finaleRedshift` (~0.85, 0 = off).

### 1.4 Spin-up and tremor

- **Spin-up**: a collapsing star spins up violently (figure-skater effect). `blackHoleSpinSpeed` is a flat
  rate today. **Must be an angle computed from `sequence`**, not an accumulated `+= rate * delta`, or
  scrubbing backwards won't rewind it. It composes with the existing idle spin:
  `rotation.y = idleAngle + finaleSpinAngle(sequence)`. New param: `finaleSpinTurns` (~2.4).
- **Tremor** (0.00–0.16): anticipation before the fall — shards tighten slightly, spin begins to rise, a
  faint brightness swell. Currently the finale starts mid-thought.

### 1.5 Split the horizon's curve from the disc's

`blackHoleGroup.scale` still scales horizon **and** rings together, so the accretion disc inflates from a
point. Real discs are already extended; what appears is the shadow.

Add `horizonForms` alongside the existing `ringForms` (same `baseScale × form` pattern,
`applyObjectTransform` already composes it for ring entries) and give the two different curves. Keep the
group at full scale.

### 1.6 Expose the finale params

`FINALE_PLAY_SECONDS` is hardcoded in `SunLab.tsx`; it should become `finaleDuration`. Phase boundaries
stay as named constants — a dozen timing sliders would be unusable and they are one edit away.

---

## 2. Open questions needing eyes on a render

### 2.1 The blue face — unresolved

The glow domes' real emissive maps colour the over-the-hole face **blue**, but Sketchfab doesn't show it.
The obvious explanation was **tested and ruled out**: `light1/2/3` are `alphaMode: MASK`, but 0% of their
diffuse alpha falls below the 0.5 cutoff, so nothing is discarded.

Remaining candidates: additive blending washing it out against black, or UVs placing it on the far side.
**Try the new `blending` control set to `additive` on `light1/2/3` first.** The reprocessed masks are kept
in `public/models/black_hole_tex/` (with a README) but are no longer loaded — if the blue genuinely
survives, they return as an explicit toggle, never as a load-time rewrite.

### 2.2 Accretion `swallow radius` default

`0.28` (in sun-radii) was estimated from the horizon-to-ring-span ratio, not measured against a render. If
particles vanish before reaching the hole, or sail into it, that slider is the fix. Could be made automatic
by feeding the measured `blackHoleHorizonRadius` in — deliberately not done, to avoid guessing.

---

## 3. Housekeeping

- [ ] **Commit the lensing + spiral work.** Uncommitted: `SunLab.tsx`, `useSunLabScene.ts`,
      `hud/BlackHoleSettings.tsx`, `hud/GlobalControls.tsx`, `sunLabPresets.ts`, `sunLabState.ts`,
      plus new `accretionShader.ts`, `lensingShader.ts`, and the docs.
- [ ] **CC-BY-4.0 attribution is nowhere on the site.** The model is *"Black Hole" by NestaEric*, and
      credit is **required** wherever it ships. Licence text: `models-src/black_hole-LICENSE.txt`.
      This is a legal obligation, not a nicety — it needs to land before anything using this model goes
      public.
- [ ] **Delete `public/models/blackhole.glb`** — 14 MB, referenced by nothing (verified: 0 hits).
- [ ] **`setBlackHolePreview` is dead API** — on the handle, never called from React. Removing it also
      simplifies `applyFinale`'s `blackHolePreview` branch.

### Gotcha worth remembering

Backticks inside a `/* glsl */` template literal terminate the string. Bitten twice writing these shaders,
both times from a comment like ``// `uSequence` drives…``. Use plain words inside shader source. A guard:

```bash
python -c "
import re,glob
for f in glob.glob('components/lab/SunLab/*.ts'):
    s=open(f,encoding='utf-8').read()
    for m in re.finditer(r'/\* glsl \*/ \`(.*?)\`', s, re.S):
        if '\`' in m.group(1): print('STRAY BACKTICK in', f)
"
```

---

## 4. Parked — bigger than this project

- **Real raymarched gravitational lensing.** The current pass distorts the *rendered frame*, so it cannot
  bend light from behind the hole around to the front (the Interstellar arc). That needs raymarching a
  curved metric or a cubemap trick. ~80% of the look is already there for ~5% of the cost; the rest is its
  own project. The model even ships an unused `black_hole_distortion` material at opacity 0 that the
  artist likely intended for this.
- **Face-on camera for the finale.** The reference storyboard is composed looking straight down the disc
  axis; the lab orbits in 3/4. Matching it means committing the camera, which is currently the user's.
- **Stretched particles.** The spiral uses round sprites. Stretching each along its velocity would read as
  strands rather than dots and get closer to the reference's filaments — costs 4 verts per particle or an
  instanced quad.

---

## 5. Performance notes (for when this leaves the lab)

`CLAUDE.md` requires 60fps. Current costs:

- **Accretion**: cost ≈ `count × pointSize²` (fill rate, not vertex count). 120k at the default ~6px is
  around 4M fragments — comfortable. **Doubling `size` quadruples it.** Reach for `size` before
  `ACCRETION_COUNT`.
- **Lensing**: one fullscreen pass; negligible. `strength: 0` makes it a pass-through.
- **Models**: `fractured_sun.glb` is still **46 MB and never run through `optimize:models`** (intentional,
  per the original lab plan). That will not ship as-is — it needs its own recipe when the finale moves to
  the site.
