# CLAUDE.md

> **Rewritten 2026-07-28** against the actual source; **revised 2026-08-02** when every authoring
> route, tuning panel and runtime knob was deleted (see "Nothing is configurable at runtime"). If you
> find this file disagreeing with the code again, the code is right: fix this file as part of the
> change.

---

# PART 1 — The brief

## Project Overview

**Voidix** is a premium software studio specialising in custom web applications, SaaS platforms,
enterprise CRM, mobile applications, AI solutions, and digital product design.

The name comes from orbital systems, gravitational movement, celestial mechanics, and
interconnected ecosystems.

**The website is not a marketing page. The website is the demonstration.** Every interaction,
animation, transition, and visual element must communicate innovation, technical excellence,
precision engineering, premium quality, and future thinking.

## Primary Objective

The goal is a site that can realistically **compete on Awwwards**. Evaluate every decision against:

> *"Would this feel impressive next to recent Awwwards winners?"*

If no — don't build it. Propose something more original, memorable, immersive, or technically
impressive.

## Creative Principles

**1 · Avoid generic agency design.** No generic hero sections, gradient backgrounds, floating
cards, feature grids, SaaS landing layouts, Framer-style templates, or startup aesthetics. If a
section resembles a typical agency site, reject it.

**2 · Create experiences, not pages.** Every section is a scene: orbital systems reacting to the
cursor, scroll-driven worlds, cinematic camera movement, particle systems, physics. The site should
feel alive.

**3 · Motion first.** Motion is a design language. Avoid basic fades, slides, and generic scroll
reveals. Prefer morphing, spatial transitions, depth, camera travel, object transformation,
procedural animation. Motion communicates meaning.

**4 · Use 3D purposefully.** Never decoration — every 3D element supports the narrative.

**5 · Design for emotional impact.** Curiosity → wonder → engagement → trust → excitement. Create
moments users want to share.

## Awwwards Evaluation Framework

Score any proposed feature 1–10 on: **Creativity · Innovation · Interaction · Visual Design ·
Motion · Technical Excellence · Memorability.** Anything below 8 in any category gets redesigned.

## Brand Personality

Voidix **is**: visionary, intelligent, precise, premium, futuristic, confident.
Voidix **is not**: corporate, boring, generic, minimal for minimalism's sake, trend-following.

## Content Standards

Never generate generic agency copy — no *"we build digital solutions"*, *"we transform
businesses"*, *"your trusted partner"*. Every headline should be distinctive; every sentence should
reinforce the Voidix universe. The established voice is **a claim, then the thing that backs it
up** (see `faqEntries.ts`, `worksProjects.ts`).

## Decision Rule

Before proposing anything, ask: Is this unique? Memorable? Technically impressive? Does it
strengthen the Voidix identity? Could it appear on Awwwards? If not — build something better.

---

# PART 2 — The system as it actually exists

## Stack

**Next.js 14.2 (App Router) · TypeScript (strict) · Tailwind CSS.**

| | |
|---|---|
| `three` ^0.184 | All WebGL. Four independent scenes — see below. Always dynamically imported (`ssr: false`). |
| `gsap` + `ScrollTrigger` + `ScrollToPlugin` | Used **directly**. No `@gsap/react`, no `useGSAP`. |

There is **no** shadcn/ui, no Radix, no Framer Motion, no form library, no validation library, and **no
smooth-scroll layer** — scroll is native. (The bottom sheet in `components/ui/Drawer` is hand-rolled for
exactly this reason. It is worth keeping that way beyond dogma: the one thing an off-the-shelf sheet
could not know is that this site's carousel steps on `wheel`/`touchmove` bound to **`window`**, so a
drag inside the sheet would also advance the section behind it. `useDrawerSheet` swallows the gesture
before it reaches window — the same trick `useScrollGuard` uses for the FAQ panel.) (`lenis`, `ogl` and `@gsap/react` were dependencies that
nothing imported; removed 2026-07-28. If you want smooth scroll, wire it deliberately and re-sync
ScrollTrigger to it.)

## Design tokens

Defined in `app/globals.css` `:root`, exposed to Tailwind in `tailwind.config.ts`. **Never hardcode
a colour.**

```css
--bg: #060606;                          /* near-black page background */
--fg: #ebe8e0;                          /* warm off-white text        */
--muted: rgba(235, 232, 224, 0.38);     /* secondary / metadata       */
--accent: var(--sun-accent);            /* → --heat-600, the sun's amber #ff8a1a */
--accent-deep: #8f4400;                 /* the anchor, for the CREAM  */
--border: rgb(var(--heat-600-rgb)/0.1); /* hairlines — warm, on dark surfaces only */
--card: #0d0d0d;                        /* elevated surfaces          */
```

Non-token colours that matter: the hero's cream `#e2dfd2` and `--hero-invert-text: #c0c0c0`.

### The heat ramp (added 2026-08-04)

**There is one colour scale, `--heat-000 … --heat-999`, and it is a TEMPERATURE scale, not a tint
scale** — the hue rotates 11° → 46° as luminance climbs, because that is what hot matter does.
Luminance is strictly monotonic; keep it that way, several consumers were graded against a stop's
value rather than its hue.

Nine of its twelve stops were values already authored by hand in separate files (`portalGate`,
`accretionGrowth`, `gatherShader`, `chamberTuning`, `SunModelCanvas`, deck 03). The ramp did not
invent a palette — it named the one that had already converged. Full audit and rationale in
`docs/amber-color-system.md`.

`--accent` → `--sun-accent` → `--heat-600`, aliased all the way down. Retune `--heat-600` and the
navbar, the meters, the CTA, the contact form and the footer all follow.

⚠ **The bottom half of the ramp is not for type.** `--heat-400` and below fail 4.5:1 even on the page
black (`#d92a05` is 4.13:1). Those stops are light, geometry and glow. The floor for small text on
black is `--heat-500` (7.80:1).

⚠ **Amber on a light background needs deepening — pick the accent by SUBSTRATE.** The raw `#ff8a1a`
manages 1.77:1 on the hero's cream, nowhere near the 4.5:1 small text needs. `--accent-deep`
(`#8f4400`, 5.93:1 on the cream) exists for exactly this and `--hud-accent` now aliases it. Check any
retune against the cream, not against black. (`chamberTuning`'s `holoTint` was the other deepened
value, at `#a85400` for the WHITE room; that room is dark now and it is back to the raw `#ff8a1a`.)

**The cool axis is the counterweight, and it has a rule.** `--slate-200/400/600/800`, mirrored for
the WebGL scenes in `lib/coolPalette.ts` — amber only reads as heat if something in frame is cold.
Every scene knew this and each picked its own blue; there were eight and three were the same colour
under different names. **It is lighting and substrate ONLY — never brand, type or UI.**

**The one deliberate exception** is the deck's AI ship (`deckServices` 04), a purple→cyan that is
kept on purpose. The fleet is allowed one alien. Don't "fix" it.

**Type:** `--font-syne` (Syne, 700/800) for display via `.font-display`; `--font-dm-sans` (DM Sans,
300/400/500) is the `<body>` default. `.eyebrow` is the uppercased kicker helper. A fluid scale
(`--fs-micro … --fs-mark`) drives sizing — use it rather than fixed px.

**All CSS lives in `app/globals.css`** (~2,700 lines, class-based). There are no CSS Modules.

## Responsiveness — non-negotiable

Everything ships working from ~360px phones to large desktops **in the same change**.

- **Fluid by default** — `clamp()` / viewport units and the `--fs-*` tokens, not fixed px. Reach for
  a breakpoint only when fluid scaling genuinely can't fix the layout.
- **There are two breakpoints, and they mean different things.** `@media (max-width: 51.25em)`
  (≈820px) is the main one — reuse it for anything that is simply "narrow", and most things only need
  this. `@media (max-width: 30em)` (480px) is the TRUE PHONE, added 2026-08-04 for the contact
  section: a 390px portrait phone and an 800px landscape tablet are not the same problem, and the
  contact footer's three link columns are correct at 800px and wrong at 390px. Don't reach for 30em
  when 51.25em would do.
- **…and three on the HEIGHT axis, added 2026-08-12, kept together in one `SHORT FRAMES` block.** Until
  then there was not a single `max-height` query in `globals.css`, which is why every height defect on
  this site was invisible: the contact form was **clipped** (nothing there scrolls) and the enquiry
  dialog scrolled, both from one fixed rhythm authored on a full-height desktop. ⚠ **The shape that
  breaks it is not a small window, it is a LANDSCAPE PHONE — 932 × 430, which is WIDER than 51.25em.**
  It gets the full desktop layout and none of the height. `38em` (608px) is where the contact section
  starts giving its rhythm back; `32em` (512px) is the landscape phone, where the bottom sheet gives up
  nearly the whole frame; `30em` (480px) is where the contact form finally becomes a sheet
  (`useIsShortViewport` — no CSS rule, it is a choice of component). Width questions live with their
  section; height questions do not — one short frame squeezes the section, the sheet and the dialog at
  once, so they stay in one place.
- ⚠ **The sheet's height gate was `38em` until 2026-08-15 and it was catching ORDINARY LAPTOPS.** 608px
  of viewport is not a small screen — a 1080p laptop at 125% display scaling has ~500–560px once the
  browser's chrome is off the top — so a large share of real desktops reached the one place the site asks
  for your details and were handed a button. The fix was to make the form **fit** rather than to hide it
  sooner: below 38em the section's own rhythm gives ~40px more **and** Name and Mobile fold onto one
  row, plus `.contact-panel` is bounded to its body (`max-height: 100%`, with `align-items: safe center`
  above it) so it can never climb under the navbar. Note the order — **a field per row is the default and
  the form only spends a row once the section has spent everything else.**
- ⚠ **Field PAIRING is a NUMBER now (`--enquiry-half-span`), read by exactly one declaration.** This file
  used to forbid pairing on a height query, and the reason was sound but was about mechanism: the variant
  modifier owned `grid-column` and a height rule would have owned it too, so two rules would write one
  property and drift. `--half` marks a field *pairable*; the knob says whether pairing happens; the
  variant (`.enquiry-form--application`, always) and the frame (`max-height: 38em`) both only ever set
  the knob. **Never write `grid-column` on a field anywhere else** — that is still the rule. ⚠ The frame's
  boundary was 32em for one revision and shipped a **scrollbar inside the contact panel** — a height
  budget assembled out of estimated line-heights is worth about 30px, so put such a boundary where there
  is real margin on both sides of it, not where the sum came out at zero.
- ⚠ **…and pairing was the last give the APPLICATION had. It is TWO STEPS as of 2026-08-16**
  (`EnquiryForm`, `useStepTransition`): *01 · You* (name\*, mobile, email\*, why you) and *02 · Your work*
  (what you are looking for, a link, a CV). Seven fields plus a drop zone is ~780px of content in a dialog
  that is **370px tall on a landscape phone**, and no amount of rhythm closes that — the split is the only
  give left that is structural. The split is BALANCED, not tidy: "why you" belongs to the work on meaning
  alone and sits in 01 because 02 carries the drop zone, the tallest control in the form.
  ⚠ **Both steps stay MOUNTED, `hidden`, never unmounted** — one `<form>`, one `FormData`, so a field that
  stopped existing would stop being submitted and every typed value would be lost on a step back. `hidden`
  is also what takes the step out of the tab order, which `opacity: 0` would not. ⚠ `.enquiry-step[hidden]`
  must restore `display: none`; the step is a grid and an author `display` beats the attribute's UA style.
  ⚠ **`.enquiry-form--stepped` is a STACK of grids** — the form becomes a flex column and each step carries
  the grid, so the two gaps are variables (`--enquiry-row-gap` / `--enquiry-column-gap`) that both boxes
  read. Retune the variable, never `gap`. ⚠ The step transition tweens the wrapper's height, and the
  outgoing height **cannot be measured in an effect** — by then the DOM is already showing the new step. It
  is captured in the handler, before the state update.
- ⚠ **A sticky bar's fade has to EARN itself, and the dialog now proves it at runtime.**
  `.enquiry-actions`' gradient exists so content passes under the button; where nothing scrolls it is an
  opaque strip across the bottom of a pane of glass. The two-step split stopped the dialog overflowing, so
  the fade is gated on `data-overflowing` (`useScrollOverflow`, which observes the CONTENT as well as the
  box — a step swap and a validation line both change height without touching the scroller). The sheet
  needs no test: its surface is solid `--card`, so the gradient there is a free no-op.
- **⚠ Give on height with a `clamp(floor, Nvh, ceiling)` before reaching for either of those.** Every
  gap in `.enquiry-form` is fluid this way, and each coefficient is picked so it **hits its 2026-08-12
  value at a 1000px viewport** — a full-height desktop renders what it always did, to the pixel, and the
  curve is only ever a give below that. ⚠ **The maxima were raised on 2026-08-15 and NOT ONE COEFFICIENT
  MOVED**, which is exactly what kept that property: the raise only opens the curve *above* 1000px, so a
  1440-tall monitor gets a rhythm to match its screen instead of a phone's spacing in a 34rem panel.
  Retune a coefficient and you break both ends at once. `.dialog-title` needs *two*
  viewport terms summed (`1.1vw + 1.8vh`) for the same reason the landscape phone exists — it is short
  exactly where it is wide, so a `vw`-only clamp sets display type at its maximum on a 430px frame.
- **Full-height boxes use `100svh`, with a `100vh` line above it as the fallback.** On mobile browsers
  `100vh` is the LARGE viewport — the height the page would have with the chrome hidden — so anything
  pinned to the bottom of a `100vh` box (the fleet's carousel strip, the works arrows, the contact
  footer) sits under the toolbar. `svh` is the small viewport and, unlike `dvh`, never changes as you
  scroll, so it can't reflow mid-gesture. Applies to `.hero-section`, `.deck-overlay`, `.works-overlay`.
- **3D scenes reframe, not stretch** — update camera aspect on resize, keep subjects framed at
  portrait, clamp DPR. ⚠ **The portrait pull-back lives in `lib/portraitPullback.ts` and BOTH the deck
  and the works field read it from there.** It used to be one inline expression in `useWorksField`'s
  resize handler, which was fine until you remember that the services→works flight hands one camera
  between two renderers: the field pulled back on a phone, the flight did not, and the mark arrived
  filling the frame and shrank by 1.9× the instant browsing took over. The flight now ramps between
  the two framings, exactly 1 at progress 0 (the fleet's resting shot) and exactly the browsing scale
  at 1 (`FLIGHT_LANDING_KEY`). Change one scene's use of it and you must change the other's.
- **Scrubbed animation must survive resize** — `invalidateOnRefresh` + function-based tween values,
  measure with `measureUntransformedRect` (never a transformed `getBoundingClientRect`), and
  `ScrollTrigger.config({ ignoreMobileResize: true })` so a mobile address bar doesn't re-pin.
- **Phones don't mount the optional hero effects at all** — `useIsLowPowerViewport` unmounts
  `FluidCursor` and `HeroInstruments` below 760px / on coarse pointers. Hiding with CSS leaves the
  rAF loops running, which is the opposite of the point. ⚠ **That gate cost one thing it shouldn't
  have, and `HeroScrollCue` is the repair** (2026-08-12): the scroll cue lived at the bottom of the
  HUD's left column, so unmounting the panel took it with it — and the platform that most needs
  telling the page wants a gesture was the one left with nothing saying so. It is back as static
  markup with one keyframe, gated in **CSS at 51.25em** rather than in JS, because the reason the HUD
  is unmounted (four rAF loops) simply does not apply to it. The two cues are never up together.
- **⚠ `useIsLowPowerViewport`, `useIsNarrowViewport` and `useIsShortViewport` are three different
  questions.** The first is *how much work can this device do* (coarse pointer or <760px) and gates
  WebGL. The second is *how much room is there, ACROSS* (the 51.25em query, mirrored from the CSS) and
  gates LAYOUT. The third is *how much room is there, DOWN* (30em) and gates layout too — **only the
  contact section asks it**, and it exists because a landscape phone clears the narrow breakpoint
  while having less height than a portrait one. A phone answers yes to all three; a narrow window on a
  fast desktop wants the narrow layout and the full effects.
- **Copy that doesn't fit goes in the drawer, not in the bin.** `components/ui/Drawer` is the phone's
  bottom sheet: services, works, contact and the navbar all use it. Every section past the hero is one
  pinned viewport with a live scene behind it, so on a phone the screen keeps only what NAMES the thing
  you're looking at and everything else is a tap away. ⚠ It portals to `body` — ScrollTrigger wraps the
  pin in a *transformed* spacer, which turns `position: fixed` inside the hero into something that
  behaves like `absolute` (the same reason `FaqHologram` lives in `page.tsx`).
- **⚠ A hard `<br/>` in a headline is a desktop instruction.** On a 360px screen it compounds with the
  natural wrap — the fleet's title came out as *"One craft at / a time. / Bring it / online."* Wrap each
  sentence in a span, drop the `<br/>`, and let `text-wrap: balance` even the lines. Not
  `text-align: justify`: at a ~310px measure it opens rivers rather than closing the rag.

## Project structure

```
app/
  layout.tsx        # fonts, Navbar, metadata
  globals.css       # tokens + every component's CSS
  page.tsx          # the site: the one pinned journey
  about/page.tsx    # ┐ the DOCUMENT routes (added 2026-08-06). Ordinary native scroll — no pin,
  careers/page.tsx  # ┘ no WebGL, no scene. See "Two kinds of route" below.

components/
  layout/Navbar/
  layout/PageShell/  # the document routes' frame: field, masthead, orbit rail, footer
  pages/             # ⚠ a ROUTE's content (About/, Careers/) — not a homepage section
  sections/
    Hero/           # Hero, HeroSun, SunModelCanvas, HeroInstruments/
    ServicesDeck/   # the fleet carousel + DeckCanvas + hullMaterial
    WorksField/     # the project field + FieldCanvas + the mark systems + transitions/
    Chamber/        # the room: walls/ground/plinth, FaqHologram/
  effects/
    IntroSequence/  # loader: GatherCanvas, gather.worker, LoaderTelemetry/
    FluidCursor/    # hero ink trail (hand-rolled WebGL fluid sim)
    ConstellationFrame/
  ui/
    Drawer/         # the phone's bottom sheet — shared by services, works, contact and the navbar

lib/                # shared: the pin's layout maths, events, perf systems, tuning constants
scripts/
  optimizeModels.mjs    # `npm run optimize:models` — the road in from a RAW Sketchfab export
  buildModels.mjs       # `npm run build:models`   — the road from a shipped GLB to a better one
  compareModels.mjs     #                            the invariants both of the above must not break
  optimizeTextures.mjs  # `npm run optimize:textures` — the standalone maps, which no GLB contains
docs/               # living design + state docs
```

### Two kinds of route — and `/` is only one of them

**Added 2026-08-06.** For most of this project's life the homepage was the only page, and a lot of
the code below was written on that assumption. It no longer holds.

| | `/` | `/about`, `/careers` |
|---|---|---|
| scroll | ONE pinned ScrollTrigger; every section is an overlay inside it | native, ordinary document flow |
| 3D | four scenes | none |
| libraries | gsap + ScrollTrigger + three | none used (⚠ gsap still *ships* — see below) |
| copy | in a content file per section | same convention: `aboutContent.ts`, `careersContent.ts` |
| CSS | `globals.css` | `globals.css`, the `.doc-*` block at the end |
| width | full bleed, the shared padding expression | **the same, since 2026-08-21** — see below |

⚠ **The document routes had drifted into a SECOND responsiveness system and were pulled back onto the
homepage's on 2026-08-21.** `.doc-inner` carried `max-width: 76rem` + `margin: 0 auto`, which is the
exact defect `.contact-panel`'s header records being rewritten out of — a hard cap reads nothing about
the frame, so 1920 and 2560 both rendered an identical 1216px island while `/` ran edge to edge, and the
footers stopped looking like each other. There is now **no centred container on any route**: every
surface is the viewport minus `clamp(1.5rem, 5vw, 5rem)`, and copy is held by MEASURE (`62ch`, `58ch`,
`46ch`, `18ch`) exactly as `.works-detail`'s `34ch` holds the works head. Three components in
`data-wide` sections that the container had been silently sizing now carry their own caps
(`.doc-track-detail`, `.doc-instruments`, `.doc-role-columns`) — **a new block of prose in `.doc-flow`
with no cap will set a 2400px line.** The `.doc-footer` block and `PageFooter`'s header carry the rest.

⚠ **These routes DO have a third width breakpoint, `64em`, and it is the one legitimate divergence.**
It hides the orbit rail's arc when there is no room to stand an instrument beside the prose — an object
`/` has no equivalent of. `51.25em` and `30em` mean what they mean everywhere else.

**The rules in this file about the pin, the crossings and the scene budget apply to `/` only.** The
right way to honour "one pin" for a page that is genuinely prose is to keep it out of the pin
entirely — not to build a second one. See `docs/about-careers-plan.md`.

⚠ **`--doc-progress` IS THESE ROUTES' SCROLL SPINE, and `useOrbitRail` is the only thing that writes
it** (design pass, 2026-08-11). It was the rail's own number; four other things now read it, all in
CSS and all in `globals.css`: the field's bloom **rises, grows and gains heat** across the descent
(the page is an approach toward a star that is off-frame), the two star layers **parallax** at
different rates, the masthead's star **dims** as you leave the top, and the phone's progress hairline
does what it always did. That is the whole of the document routes' motion system and it costs **no
listener, no observer and not one line of animation code** — it is one variable, already published
every frame for the arc.

**So: delete or refactor `useOrbitRail` and the entire page stops breathing, silently and with no
error.** Every consumer defaults (`var(--doc-progress, 0)`) so nothing breaks visibly — it just goes
inert, which is a worse failure than a crash. If the rail is ever reworked, the variable is the
contract, not the arc.

⚠ **The document routes DO have an image now, and it is CSS.** `.doc-masthead-star` is three gradients
and a 120 s rotation standing in the space the offset lead opens up. It exists because a page whose
entire visual weight was typography and hairlines reads as unfinished rather than restrained — and it
is **deliberately not a canvas**, for exactly the budget reason `PageShell`'s header gives about the
field. It is the hero's light seen from much further away. Do not grow it into a second sun.

⚠ **Three things in the shared chrome were written assuming one route, and all three have been
fixed** — check them before adding a fourth route:
1. `useNavbarAnimation` waited on `REVEAL_EVENT`, which only `IntroSequence` fires. Off the homepage
   the bar was invisible until a 7.2 s fallback lapsed. It now takes an `isHomepage` prop.
2. `.nav-root` is a fixed full-width strip at z-9999 and a transparent box still hit-tests — it ate
   every click across the top of a document page. Now `pointer-events: none`, with its controls
   taking their own back.
3. The navbar's `/#work` hrefs went nowhere: **nothing read `location.hash`**, despite a comment
   claiming the pin picked it up on arrival. `useHeroAnimation`'s reveal now consumes it through
   `requestSection`.

⚠ **Two known costs on the document routes, both measured and both deferred deliberately:** the
root layout preloads ~2.1 MB of star/Draco/Basis on *every* route, and the navbar's static `import
gsap` puts ~69 KB of unused animation library on both pages. `docs/about-careers-plan.md` §1e and §6
have the numbers and the fixes.

**Component file convention:** each component lives in its own folder named after it, holding its
`.tsx` plus everything it owns (config, events, sub-hooks, shaders). A component that owns a WebGL
scene co-locates its scene hook (`ServicesDeck/hooks/useServicesDeck.ts`); only genuinely shared
things get promoted to `lib/`.

---

## Where the words come from — the admin panel

**Added 2026-08-13.** The copy on this site is edited in a separate application, `voidix-cms`
(`../voidix-cms`) — a Next 16 + Prisma + Supabase panel that is **read/write to the database**. This
repo is **read-only** and never touches the database at all: no Prisma, no Supabase client, no
connection string. It reads one JSON document over HTTP.

```
  voidix-cms                                    this repo
  ──────────                                    ─────────
  draft tables ──publish──► content_releases
                            (append-only)
                                 │
                GET /api/content │  x-voidix-secret
                                 ▼
                       lib/cms/fetchPublishedContent.ts
                                 │  ISR: one tag + a 600 s backstop
                                 ▼
                       resolve*Content(published ?? null)
                                 │
                                 ▼
                       the component, which cannot tell which it got

           POST /api/revalidate ◄── the panel's "I have published" ping
```

⚠ **`fetchPublishedContent` NEVER THROWS, and every consumer resolves `null` against this repo's own
copy.** A panel that is down, mid-deploy, unconfigured or simply not running on a developer's laptop
must not take a page with it — the worst outcome is a page serving what it served before the panel
existed, which is also what keeps `npm run build` working on a fresh clone with no environment.

⚠ **The content files in this repo are FALLBACKS now, not the source of truth.** `aboutContent.ts`
and `careersContent.ts` say so in their headers. Editing one changes what an *unconfigured* site says
and nothing about what a connected one says. Keep them in voice anyway — they are what a visitor sees
if the panel is down.

⚠ **The panel owns words; this repo owns the machine that says them.** A service has no `modelPath`,
`profile` or `light` in the payload; `ABOUT_SECTIONS` and `CAREERS_SECTIONS` stay here because each
`key` is simultaneously an anchor id and an orbit-rail station. `DeckService` resolution is therefore
a **merge**, and ⚠ the join is **array position**, because `deckTuning.ts` keys ship placements
positionally and buries that position inside `hiddenParts` strings like `"2:14"`. **This is why the
panel cannot add, reorder or delete a SERVICE.**

⚠ **A PROJECT is no longer in that category, and the difference is worth reading before you assume
symmetry** (2026-08-14). A project used to carry a repo-owned `markId` naming one of four logos in
`marks.ts`, and `worksTuning.ts` held four hand-authored camera poses — so the count was pinned at
both ends and `resolveWorksProjects` discarded the whole payload when the panel disagreed. Both are
gone: the mark is **uploaded per project** (`markSvgUrl`, dereferenced server-side by
`lib/cms/markSource.ts`) and the camera path is **generated from the count**
(`buildProjectViewKeys`). There is nothing structural left for a fifth project to collide with, so
`WorksProject` is now a straight resolve rather than a merge and **the panel adds, reorders and
deletes projects freely.** A project with no upload grows its own **initial**. Plan of record:
`docs/works-marks-cms-plan.md`.

⚠ **`lib/cms/publishedContent.ts` mirrors `voidix-cms/lib/content/contentPayload.ts` and NOTHING
ENFORCES IT.** Two repos, one JSON document, no shared package. A field renamed on one side and not
the other compiles on both and arrives `undefined` — and because every consumer falls back rather than
throwing, the symptom is a section quietly reverting to placeholder copy. **Change one, change the
other in the same sitting.**

**State: `about` and `careers` read the panel. The other seven keys do not yet** — they are all on the
homepage, whose content files are imported at module scope by the client components that render them.
`docs/cms-integration-plan.md` is the plan of record for the rest, and for the search-visibility work
that has to happen in the same components.

---

## ► The scroll spine — read this before touching any section

**The entire public site is ONE pinned `ScrollTrigger`, owned by `lib/hooks/useHeroAnimation.ts`.**
`app/page.tsx` renders only `<Hero/>`, `<HeroSun/>`, `<IntroSequence/>` and `<FaqHologram/>`. Every
"section" past the hero is an **absolutely-positioned overlay inside `.hero-section`**, revealed by
scroll progress. There is no stack of sections and no second pin.

```
  INTRO      HERO       SERVICES     ══HANDOFF══   WORKS      ══REVEAL══   CHAMBER
  ┌─────┐    ┌─────┐    ┌──────┐       (180vh)     ┌──────┐     (140vh)    ┌──────┐
  │dust │───►│square───►│4 craft│── craft flies ──►│4 marks│── camera ────►│ room │
  │→ sun│    │fills │   │+ gates│   off, then the  │grown  │   backs out   │ + FAQ│
  └─────┘    └─────┘    └──────┘   mark arrives    │from   │  of "screen"  │ holo │
     ▲                             from the dark   │stone  │               │      │
     │                                             └──────┘                └──────┘
     │                              ── the sun COLLAPSES across the handoff and holds ──
     │       fillFraction ──┤├── carousel: stops separated by wide CROSSINGS ─────────┤
     │                                                                          │
     │   ══LOOP══      CONTACT        ══RETURN══                                │
     │   (200vh)       ┌──────┐        (140vh)                                  │
     └───── fall ──────│ form │◄─── dive back INTO the screen ──────────────────┘
        into the hole  │black │      mark gone, star restored,
        → black        │ hole │      then it DIES (the finale)
        → teleport     └──────┘
        → cream, hero
```

**The last span is not a scroll.** The pin has a fixed range and contact sits at progress 1, so the
loop is a **teleport** — `scrollTo(0)` under cover of the hole's own shadow. That is why
`LOOP_RESET_EVENT` exists: everything that *eases* toward a target has to be told to stop easing and be
there now, or the site visibly un-plays behind the cream. See `docs/contact-loop-plan.md`.

**…and the loop runs BOTH WAYS as of 2026-08-15** (`docs/reverse-loop-plan.md`). Once a visitor has been
through the hole, the hero's *Back to the horizon* control and a deliberate wheel-up at the top take them
back — the forward cinematic mirrored beat for beat: **black closes from the EDGES in** (the iris, a
liquid mask), solid black, the jump, then the iris opens onto a hole **already zoomed in under heavy
lensing**, which relaxes into a plain black hole as the contact copy fades back up.

⚠ **The return does not scroll, and this is the design.** The obvious build — park the scrollbar partway
into the dive and glide it back, so the return IS the crossing scrubbed the other way — was built, and
shipped three defects at once (`docs/reverse-loop-plan.md` §10). The jump lands on the **contact stop**,
the pin then **does not move again**, and the zoom-out is one authored tween of one number.
- ⚠ **`publishDive` is the single writer, and it takes `max(crossing, arrival)`.** Two contributors, one
  published value, an explicit combine — the shape `combineChamberTarget` uses. `max` is what stops the
  crossing's resting 0 pulling the arrival down, and what hands a visitor who scrolls mid-arrival back to
  the scroll. The forward teleport still fires off the **crossing's own** value, never the combined one.
- ⚠ **`REVERSE_ARRIVAL_DIVE` (0.66) is picked from the dive's WINDOWS, never from the boundary at 1.**
  Below `DIVE_BLACKOUT[0]` so the hole is visible rather than blacked out; high enough that the lensing is
  near full, because its relaxation is the shot; above `LOOP_CONTACT_UI_FADE`'s end so the copy returns
  last. An earlier cut used 0.98 — chosen for its distance from 1 — and that is *inside the blackout*: it
  shipped "there is no black hole at contact".
- ⚠ **`LOOP_RESET_EVENT` could not be reused for the return** — see the event table. Every one of its
  handlers writes **zero**, which is right for a jump to the top and wrong for a jump anywhere else.

**The layout is data, not arithmetic spread through the file.** `useHeroAnimation` declares a list
of sections; `lib/carouselLayout.ts` derives everything else from it:

```ts
const carouselSections = [
  { key: 'services', stopCount: craftCount,   setActiveStop: …, crossingAfter: { scrollVh: 180, apply: applyServicesToWorksHandoff } },
  { key: 'work',     stopCount: projectCount, setActiveStop: …, crossingAfter: { scrollVh: 140, apply: applyWorksToChamberReveal   } },
  { key: 'faq',      stopCount: 1, crossingAfter: { scrollVh: 140, apply: applyChamberToContactReturn } },
  { key: 'contact',  stopCount: 1, crossingAfter: { scrollVh: 120, apply: applyContactToHeroLoop      } },
  { key: 'loop',     stopCount: 1 },   // a landing pad, never rested on — arriving IS the teleport
];
```

⚠ **The last entry is not optional.** `computeCarouselLayout` records every `crossingAfter` as
`toStop: lastStop + 1`; on the final section that stop does not exist, so its `endProgress` is `NaN` —
and because `applyCrossings` walks the whole list, **every** crossing on the site gets NaN, not just
that one. A crossing always needs a section to cross into.

`computeCarouselLayout()` returns the stop progress values, the crossing spans, the fill fraction
and each section's navbar-meter span. **Adding a section is one entry in that list** — do not
hand-roll new progress arithmetic.

**A crossing** is a wide scrubbed span between two sections. One gesture from the last stop commits
the whole glide, with input locked (`settleMs`) so it can't be cut short.

### The rules that keep this working

1. **ONE pin.** New transitions go *inside* it as a section or a crossing. This site was rebuilt
   once already because a crossing ran on three clocks and fast scroll desynced them
   (`docs/services-to-works-flight.md`).
2. **ONE clock.** Every visual in a crossing is a **pure function of its progress `0..1`**. No
   `gsap.to(…)` with a duration, no "arrived" flags, no sentinels. Each scene eases its own copy of
   the progress per frame. Consequences fall out for free: it can't be outrun, it reverses
   perfectly, and a resize just re-derives it. (The two deliberate exceptions are documented in
   `docs/works-to-chamber-reveal.md` §3.8.)
3. **Nothing scroll-driven exists before `REVEAL_EVENT`** — see Contract 2 below.

### Why the Chamber lives inside the WorksField

**A GPU texture cannot cross a WebGL context.** The space scene renders to a texture that gets
painted onto a quad in the chamber room — so the room must be drawn by the *same renderer*. That is
why `useWorksField.ts` hosts `chamberScene.ts` rather than the chamber owning a canvas. **Do not
"tidy" this.**

---

## The intro (loading screen)

`components/effects/IntroSequence/` gates every load. It is one GSAP timeline plus a WebGL "gather"
field, driven by **real asset progress** — not a timer.

- **`GatherCanvas` + `gather.worker.ts`** render dust streaming in from off-screen. The render loop
  runs in a **Web Worker on an `OffscreenCanvas`** so it keeps painting while the main thread is
  blocked parsing glTF and compiling shaders. A main-thread fallback exists for older Safari.
- **The ten shards WAIT ON SCREEN, then assemble.** For the whole download the fracture shards of
  `fractured_sun.glb` drift and turn among the dust — the largest, hottest debris in the same flow —
  then sweep in and lock together, and the star lights inside the closing shell. The intro holds its
  handoff on `SUN_ASSEMBLED_EVENT`, so the reveal can never land on a half-built star.
  ⚠ They used to wait CLIPPED off-frame (`ASSEMBLY_ENTRY_MARGIN_*` above 1) so that "you never catch a
  piece appearing". On a slow load that left the loader with nothing on it but dust for a minute, and
  the star arriving from nowhere at the end. The margins now straddle the frame edge and
  `positionShards` is driven every frame while it waits — the drift and tumble were always written,
  nothing was advancing their clock.
- ⚠ **The gate's waits are SERIAL, and that is load-bearing.** 100% does not cue the shards — the
  assembly starts only once both scenes report warm. They used to fire on the same tick, and the
  flight is delta-timed with a clamp, so it stuck mid-air rather than catching up.
- ⚠ **But each scene warms ITSELF, when its OWN assets land — not at the global 100%.**
  `ASSETS_WARMUP_EVENT` is now only a backstop for a section whose build failed. The shared wait was
  stacking two compiles and both scenes' first-ever composer render into a two-frame window at exactly
  100%, immediately before the flight. Self-warming spends the field's share inside the fleet's
  download, where the GPU is idle. **Each warm-up is one operation per frame** for the same reason.
- ⚠ **The stall is in the GPU PROCESS, not on the main thread**, and the discriminator is cheap: *does
  the worker-rendered dust freeze with it?* If yes, stop looking at JavaScript — the compositor cannot
  present anyone's frames while the GPU process is busy, worker canvases included. Both a first draw
  (allocation + upload) and a first compile land there. See `docs/loader-freeze-plan.md` §7 and
  `docs/lag-and-freeze-diagnosis.md` §6.
- **Anything built lazily and drawn later must be warmed** — `lib/warmScene.ts`, on an idle frame.
  The sun's corona, the chamber and the contact star all had the same shape: built, hidden, then
  compiling and uploading every map on the single frame they first appeared, which for two of them was
  inside a scrubbed crossing.
- Then the sun **flies from the wordmark's "o" into the hero square** and `REVEAL_EVENT` fires.

### Contract 1 — scroll is locked for the whole intro

`IntroSequence` locks scroll on mount (`html.scroll-locked`, non-passive `wheel`/`touchmove`
blockers, scroll-key blockers, `scrollRestoration = 'manual'`, `scrollTo(0,0)`) and releases it
**exactly once** in the timeline's `onComplete`. The component returns `null` when done but **stays
mounted** — never rely on effect cleanup to unlock.

### Contract 2 — no scroll-driven hero animation during the intro

The pin is created **only** inside the `REVEAL_EVENT` handler, never on mount (with a fallback
timeout if the intro is bypassed). Any new scroll-driven hero/sun animation must be gated the same
way, or a restored scroll position moves things while the loader is still up.

## The shared sun

**There is exactly one sun: `HeroSun` → `SunModelCanvas` → `fractured_sun.glb`.** It is the same
model a deleted editor authored, and its constants ARE that editor's "Peaceful" stage. This file is
now the only copy of them.

⚠ **The star does not ship all of that model. `SUN_OMITTED_PARTS` drops two of its four groups**
(2026-08-08): the 8 spun `flare` discs and the 20 `blowout` hot-spot planes. Measured `sun · bloom`
**2.00 → 0.87 ms**, a 57 % cut, and the star was the largest single span on the page — 42–47 % of the
hero's frame on a dpr 2.5 laptop.

- ⚠ **The cost is per DRAW CALL, ~0.02 ms each, not per pixel.** Three groups with completely
  different areas came out within 10 % of each other per draw; projected area predicted none of it.
  `sunBloom` renders the scene **twice**, so every mesh is submitted twice. That is why the fix is a
  shorter mesh list and not a resolution knob. (On the dpr 2.5 laptop the same call costs 16–19 ms and
  the limit there is GPU fill instead — fewer meshes wins in both.)
- ⚠ **`sunouter` — the 11 translucent shells — is NOT omitted and must not be.** It is the star's
  ATMOSPHERE: the core is an opaque ball and those shells are what make it read as burning. They also
  carry `sunouter_baseColor`, **the largest map in the file and the star's actual skin**. A procedural
  plasma (`sunPlasma.ts`) replaced them for four days and was **deleted 2026-08-12**: it bought the
  blend cost back by painting over the model's own surface, which is the one thing it was not allowed
  to spend. Recoverable from git if the trade is ever wanted again.
- ⚠ **`SUN_ABLATION_KEEP_SHELLS` IS 0 — ALL ELEVEN SHELLS SHIP.** This file said "a SHIPPING DIAL now,
  at 4", on the argument that each is `BLEND` at α 0.815 so shells five through eleven composite into a
  pixel already 99.9 % decided. **That holds only if the shells are CONCENTRIC and they are not**: one
  is the full central sphere and the other ten are one skin per fracture shard, so a view ray crosses
  about two, and "the four largest" left **seven shards with no skin at all** — a patchy atmosphere, not
  a thinner one. The constant's own header has the node tree. All eleven cost ~5.8 ms of `sun · bloom`
  on the reference laptop and that is the honest price of the model's own surface.
- **Hiding is not removing** — the geometry still downloads. After the texture cap below it is worth
  ~15 KB, so it is not worth the GLB rebuild that would break `compareModels`' mesh table.
- ⚠ **The ablation's savings ARE SPENT NOW, and until 2026-08-13 they were not spent anywhere.**
  Removing `flare` and `blowout` freed ~57 % of `sun · bloom` per call and **could not reach the star's
  quality by any path**: the allocator's only measurement of the star was taken with those very parts
  already hidden (see the allocator section), so the freed time was invisible to it, and the star was
  pinned against `STAR_RAISE_OVER_MODELS` rather than against its budget in any case. Three things now
  spend it, and all three are visible on a ~250-device-pixel object in a way a ratio point is not:
  **`antialias: true`** on the star's renderer (it was off on a canvas-size figure that was wrong by
  14×, and it is the ONLY thing that can antialias the shards' silhouette — `sunBloom`'s `sceneTarget`
  is the glow's source and is never shown, so samples there would antialias an image about to be
  blurred); **`MIP_COUNT` 3 → 5**, which extends the corona's falloff two octaves further out; and
  **`SUN_GLOW_STRIDE` 2 → 1**, so the halo is no longer a frame behind the geometry it belongs to.
  ⚠ `MIP_WEIGHTS` renormalises to the three-level sums, so `BLOOM_STRENGTH` and the journey-wide
  +5 % / +17.5 % / +30 % ramp mean exactly what they did — total glow at `BLOOM_RADIUS` 0.92 is 2.0940
  before and after. **A longer chain without that renormalisation silently re-grades the centrepiece.**
- ⚠ Omitting `flare` also **skips its recentre-and-spin setup**. `flareSpins` would otherwise keep
  rebuilding quaternions for eight invisible discs every frame — hiding the draw while keeping the
  work is the one way this cull could have cost more than it saved.

**Its textures are capped PER TEXTURE** (`buildModels.mjs` recipe, `textureSizes`): 2048² maps on a star
that never exceeds ~350 device pixels across. **1346 KB → 662 KB.** Bytes and VRAM only — it cannot move
`sun · bloom`, for the per-draw-call reason above.

⚠ **One number for a whole model assumes every map is sampled at the same rate, and on the sun that is
false.** It was a flat 512² while the shells were hidden and the magma was the only thing being sampled.
Now the shells are the surface, so: **`sunouter*` → 1024** (a sphere's equirectangular unwrap spends most
of its texels near the poles, so the visible hemisphere gets nothing like 1024 across), **`Lava*` → 512**
(shard interiors, seen for two beats — unchanged judgement, and 62 % of the bytes at 1024), **`flare*` /
`blowout*` → 256** (never drawn at all; the only lever is making the waste small).

⚠ **`resize --pattern` matches texture NAMES and a glob that matches nothing fails SILENTLY** — same shape
as the `--slots` trap. `assertTextureSizes` gates on each rule having hit something at the size it asked
for, and the build prints every texture's final dimensions. Patterns must cover everything and must not
overlap: `resize` never INCREASES a dimension, so a later unpatterned cap would undo an earlier raise.

It is driven through exactly **three nested elements, one owner each** — sharing one between two
owners is how you get a sun that jumps:

| element | owner | drives |
|---|---|---|
| `.hero-sun-layer` (outer) | `HeroSun` (base box, z-index, resize fade) + the pin (scroll transform) | where the sun sits and how big it is |
| `.hero-sun-parallax` (middle) | `useSunParallax`, and nothing else | the works camera's drag-to-look |
| `.hero-sun-flight` (inner) | `IntroSequence` (the o → square flight), then the services scale, then the reveal's fade-out | the intro handoff and the sun's opacity |

**The middle one is why drag-to-look doesn't leave the star stuck to the glass.** Everything in the
works scene belongs to a camera the visitor can drag; the sun is a separate WebGL context and cannot
be in that scene, so instead `useWorksField` publishes how far the camera has been dragged off the
pose the current stop authored (`lib/sunParallaxPose.ts`, a per-frame store) and the sun follows.

It is a **deviation**, not a world position, and that is the design: at rest the identity is exact, so
the star sits precisely where the pin put it at every stop and through every travel, and only a drag
moves it. Full world anchoring was rejected — the path orbits ±35° at a ~40° lens, so a world-fixed
sun would swing about two screen widths across the four stops and be off-frame at projects 02 and 03,
which are compositions authored with the star in them.

Its z-index walks `10001` (during intro, above the veil) → `9500` (after) → `-1` (services, so the
fleet and its labels paint in front).

### ⚠ The sun does not enter the chamber, and this is deliberate

At the works→chamber reveal the sun **fades out** over `REVEAL_SUN_FADE` `[0, 0.12]`, matched to
`OPAQUE_WINDOW` in `chamberScene` — early, while the display still fills the frame, so what you
perceive is a light dimming rather than the site's anchor vanishing. The star never reaches the
table.

Two ways of changing that have been built and reverted. **Read this before building a third.**

1. *Transform the DOM sun onto the display.* Cannot work. The room sets an opaque
   `scene.background` and the display's alpha closes over `OPAQUE_WINDOW`, so a layer **behind** the
   canvas is invisible past ~0.12; putting it **in front** leaves a flat rectangle over a screen the
   tour views at an angle. (A stale revision of this file described this as shipped, via a
   `.hero-sun-screen` element and a `lib/screenPose.ts` store. **Neither ever existed.**)
2. *Sample the sun's canvas into the space render* (`sunBackdrop.ts`, deleted 2026-07-31). The idea
   is sound — once the pixels are inside the space texture the display's own perspective carries
   them onto the table correctly — but that build had two defects: the quad was written in **clip
   space**, so the works camera could not move it, and the handoff with the DOM sun was arbitrated by
   a **threshold on eased progress**, which did not hold. Both suns ended up on screen at once.

If it is tried again: the two images must be mutually exclusive *by construction*, not by timing,
and anything living in the space scene must be positioned through the camera rather than in clip
space. The open cost is a per-frame `CanvasTexture` upload on the heaviest scene on the site.

This matters beyond the reveal: **the planned collapse finale needs a star on that screen to die.**

`SUN_COVERED_CHAMBER_PROGRESS` (`SunModelCanvas`) freezes the star just past that fade's end. Keep
the two in step — below the fade's end it freezes something still on screen; far above it, it pays
for a bloom pass on something fully transparent.

`AUTO_ROTATE_DEGREES_PER_SECOND` is **imported** from `HeroInstruments/heroReadouts.ts`, not
copied — the HUD displays that exact rate, so one source of truth stops the telemetry lying.

## Event contracts

| Event | Constant | Fired by | Purpose |
|---|---|---|---|
| `voidix:reveal` | `REVEAL_EVENT` | IntroSequence | **The** intro→site handoff. Hero pin, navbar entrance, sun z-index all wait on it. |
| `voidix:intro-active` | `INTRO_ACTIVE_EVENT` | IntroSequence | Intro is up. |
| `voidix:sun-assemble` / `-assembled` | `SUN_ASSEMBLE_EVENT` / `SUN_ASSEMBLED_EVENT` | IntroSequence ↔ SunModelCanvas | Cue and completion of the shard assembly. The intro holds on the latter. |
| `voidix:sun-forming` | `SUN_FORMING_EVENT` | SunModelCanvas | The star has lit inside its closing shell — the assembly's MIDPOINT (`CORONA_APPEAR`), not its cue. The gather field withdraws from around the star on this. ⚠ It must not key off the *cue*: the cue is only the intro asking, and on a slow load the sun has no model to answer with — so the dust pulled back from an empty "o" and stayed pulled back for the rest of the download. Fired from inside the flight, so a star exists by construction. |
| `voidix:intro-ignite` | `IGNITE_EVENT` | IntroSequence | The gather field's final rush. |
| `voidix:assets-warmup` | `ASSETS_WARMUP_EVENT` | IntroSequence | Asks each scene to compile shaders during a still beat, so the stall is invisible. |
| `deck:reveal` / `deck:hide` | `DECK_REVEAL_EVENT` / `DECK_HIDE_EVENT` | useHeroAnimation | **The fleet itself** enters/leaves — replay the craft's entrance. Nothing else. |
| `voidix:black-stage` | `BLACK_STAGE_EVENT` | useHeroAnimation (`setStage`) | A full-black scene is / is not on screen — the event form of `is-services`. Drives the sun's z-index, the fluid cursor's gate and the constellation's freeze. ⚠ Those three used to read `deck:reveal`, which was only ever right because the fleet was the first black scene you met — a **navbar jump** reaches works or contact without entering it. Keyed off the fill boundary so it cannot depend on the route. |
| `voidix:jump-begin` / `-covered` / `-arrived` | `JUMP_BEGIN_EVENT` etc. | useHeroAnimation ↔ SectionJumpVeil | A navbar jump of 2+ sections is hidden: the cover closes, the **ordinary glide** runs underneath unwatched, the cover opens once the PIN (not its scrollTo tween) has settled. Nothing is skipped or snapped. See `docs/nav-jump-plan.md`. |
| `voidix:goto-section` | `GOTO_SECTION_EVENT` | Navbar | **Every** nav item and the CTA. Carries a section key; the pin drives itself there on a distance-scaled glide. None of these sections is a place — they are overlays inside one pin, so an anchor would land on the hero whichever you clicked. |
| `voidix:handoff-progress` | `HANDOFF_PROGRESS_EVENT` | useHeroAnimation | The services→works crossing, `0..1`. |
| `voidix:chamber-progress` | `CHAMBER_PROGRESS_EVENT` | useHeroAnimation | The works→chamber reveal, `0..1`. |
| `voidix:chamber-hologram` | `CHAMBER_HOLOGRAM_EVENT` | chamberScene | The tour has arrived; the FAQ panel may unseal. |
| `voidix:hero-services` | `HERO_SERVICES_PROGRESS_EVENT` | useHeroAnimation | The hero→services span. Carries **two** fractions: `progress` (to the fleet landing) and `fill` (to the square covering the viewport). The pin owns the layout; the sun owns what to do with it. |
| `voidix:contact-progress` | `CONTACT_PROGRESS_EVENT` | useHeroAnimation | The chamber→contact return, `0..1`. Its own signal rather than the chamber's, so one number never has two writers. |
| `voidix:loop-progress` | `LOOP_PROGRESS_EVENT` | useHeroAnimation | The dive into the hole, `0..1`. Reversible; its job is to be opaque by 1. |
| `voidix:loop-reset` | `LOOP_RESET_EVENT` | useHeroAnimation | **The scrollbar has just jumped to the TOP — be at the hero's state now.** ⚠ Not a general "you were moved" signal, whatever its prose used to say: every handler writes **zero**, which is right because the destination is 0 and is exactly why a jump landing anywhere else needs the row below. |
| `voidix:loop-snap` | `LOOP_SNAP_EVENT` | useHeroAnimation | The direction-agnostic half: **`current = target`, and nothing else.** For the reverse loop, which lands at the bottom. ⚠ Dispatch only AFTER driving the crossings to the new position, or every scene snaps to the state it is leaving. |
| `voidix:loop-request` | `LOOP_REQUEST_EVENT` | ContactSection | The "Travel in time" button. Routed through the pin so button and scroll commit one cinematic. |
| `voidix:loop-reverse-request` / `-begin` / `-covered` | `LOOP_REVERSE_*_EVENT` | HeroReturnCue → useHeroAnimation ↔ LoopVeil | **The loop run backwards: hero → contact.** Request (the control, or the wheel pushed up at the top) → the pin says yes and asks for the cover → the cover says it has the screen, and the pin teleports **synchronously inside that dispatch**. |
| `voidix:loop-arrived` | `LOOP_ARRIVED_EVENT` | useHeroAnimation | A loop has completed. **Arms the way back** — the hero's return control does not render before this and the wheel gesture does nothing, so a first visit is untouched. |
| `voidix:sun-regather` | `SUN_REGATHER_EVENT` | useHeroAnimation | Replay the shard assembly at the top. **Not** `SUN_ASSEMBLE_EVENT` — the intro is still mounted and still listening to that one. |
| `voidix:current-section` | `CURRENT_SECTION_EVENT` | useHeroAnimation (`setStage`) **and** useOrbitRail | **Which named section is on screen, on ANY route.** ⚠ It exists because `SECTION_ARRIVE_EVENT` fires ONLY on a navbar jump — scrolling the whole site fires it not once — so anything treating that as "where is the visitor" measured only the people who used the bar. Published from the two places that already computed the answer and already de-duplicated it. The pin's own first stage is `"fill"`; it leaves as `hero`. |
| `voidix:stop-commit` | `STOP_COMMIT_EVENT` | useHeroAnimation (`commitStop`) | Which craft is on the pad / which project is focused. ⚠ Per STOP, where `SECTION_ARRIVE_EVENT` is per SECTION — and it carries **no dwell**: the pin knows when a stop was committed and nothing else, so the subtraction belongs to whoever wants it. De-duplicated at source. |
| `voidix:faq-entry-open` | `FAQ_ENTRY_OPEN_EVENT` | useHologramReveal | A question was chosen. ⚠ Fired before the reduced-motion branch, so the signal does not depend on which animation the visitor gets. |
| `voidix:drawer-open` | `DRAWER_OPEN_EVENT` | Drawer | The bottom sheet opened. One dispatch inside the component covers all four callers. ⚠ Its optional `journeyKey` is **not** the title — a title is CMS copy an editor can rewrite, which would split one drawer's history in two. |
| `voidix:enquiry-*` | `ENQUIRY_OPEN/START/STEP/SUBMIT/ERROR_EVENT` | EnquiryPanel (open), EnquiryForm (the rest) | The contact funnel. ⚠ They carry only what the form knows — never where the visitor was standing, which the pin already publishes, and never a field value. |
| `voidix:pixels-allocated` | `PIXELS_ALLOCATED_EVENT` | adaptivePixelRatio (`lockPhase`) | **The ratios are settled.** Fired by all THREE solvers — burn-in, section split, runtime calibrator — because any of them can be the one that decides a given load. ⚠ Anything asking the allocator what this machine got BEFORE this is told "1, and the star matches", which is indistinguishable from a real allocation on a weak machine. |

One per-frame **store** sits alongside these, for values too hot for an event: `lib/hologramPose.ts`
(where the FAQ panel is on screen). It is written every frame by `chamberScene` and read in the
consumer's own rAF — a CustomEvent or React state per frame would be a re-render per frame.

## Navbar & the per-section meters

Two stacked fixed layers: `.nav-root` uses `mix-blend-mode: difference` (auto-inverts against
whatever scrolls under it); `.nav-accent` sits behind holding everything that must stay brand-amber
(top line, orbital mark, the meters), so the blend never turns it blue.

Each nav item has a cyan meter. **A section feeds its meter by setting `--nav-progress-<key>` on
`document.documentElement`** — the hero pin publishes `home`, `services`, `work`, `faq`, plus
**`total`**, which is the pin's own progress and therefore the whole circuit as one number.

**On a phone the bar is the ORBIT FAN** (`Navbar/OrbitDial`). The bar reads `Navigate ⊙`; tap it and one
arc bows out beneath, four nodes on it, each running a leader line to its number and name. Tap a node and
you travel; tap anywhere else, or press Escape, and it folds away.

⚠ **It was a hold-and-drag gesture until 2026-08-05, and the reversal is documented rather than
forgotten** (`useOrbitDial`'s header). The gesture existed because every destination here is a scrubbed
cinematic several seconds long and a mis-tap costs the journey, not a page load — but a hold competes
with the platform's own long-press, nothing on screen says "hold me", and a sweep with no friction
feedback reads as broken when it lands between two facets. **The protection is intact under a tap:** it
still takes two deliberate acts to commit, and the second lands on a 44px target that only exists while
the fan is up. Don't "restore" the drag, and don't collapse it to one tap either.

- **`orbitGeometry.ts` is the single source for the angles**, and now the ONLY consumer of them is the
  drawing — the pointer hit-testing (`stationFromPointer`, and the dead zone it needed) went with the
  drag, because a facet is a real 44px `<button>` and the browser can hit-test it.
- ⚠ The sweep is **51°, not 180°** — the pivot is the top-right corner, so half the circle is off-screen
  and more of it is above the bar. And it starts at **105°, not 90°**: near straight-down, y barely
  changes with angle and the first two labels landed on top of each other.
- ⚠ The **radius is sized by the labels**, not by taste. Rows hang LEFT of their node (the pivot is the
  top-right corner), and the topmost node is furthest left, so `nodeX(top) − rowWidth > 0` binds. Raise
  it for a grander arc and CONTACT walks off the side.
- ⚠ A station's `transform` is what **places** it on the arc, so GSAP may only tween its `autoAlpha`.
  The swing lives on the container, which owns no layout.
- ⚠ The amber lives in `.nav-accent` with a transparent press target in `.nav-root` — the same split
  `.orbital-mark` / `.nav-mark-spacer` uses, because `.nav-root`'s difference blend turns amber blue.
  `.nav-accent` is a *preceding* sibling, so no combinator reaches back to it: Navbar writes the open
  state onto both.
- ⚠ The scrim's first gradient stop is **transparent**. It's z 10000 over a 9999 navbar, so without a
  hole it would black out the very mark being held.
`useNavbarAnimation` positions each meter by measuring live layout (re-run on resize and once fonts
are ready), so a new section's meter works with zero navbar changes. Entrance plays on
`REVEAL_EVENT`, items converging from the four directions in their `data-enter`.

## The quality allocator — models first, the star gets the rest

**Added 2026-08-07.** The site is sized for **30 fps**, and the frame is spent in priority order: a
section's **models take what they can afford, up to their own ceiling**, and whatever is left goes to
**the star**. Nothing is a fixed value — a strong machine runs the field at full density, leaves real
budget over, and the star ends up high; a weak one gives the models nearly everything and the star
sits near its floor. Solved once, in the loader, behind the veil. Full rationale in
`docs/per-section-quality-budget-plan.md` §8.

- ⚠ **`PRIORITY_TARGET_FPS` is 30, not 50.** Every solve used to aim at a 20 ms frame; against 33.3 ms
  that is √(33.3÷20) = **1.29× the ratio, 1.67× the pixels** on any machine with room above the floor.
  One number, and the largest quality change in the file. **Lower target fps means MORE pixels** — so
  `'quality'` is the *slowest* setting on that dial, not the fastest.
- ⚠ **The star's cost can only be measured as a DIFFERENCE.** WebGL is asynchronous, `unaccounted` is
  70–95 % of every frame, and both subjects live inside it. So the burn-in runs **two phases** — field
  alone, then field + star — and `B − A` is the star. That is why `SUN_DRAW_PERMIT_EVENT` exists: the
  star used to be permitted by `BURN_IN_EVENT` itself, leaving no window where the field drew alone.
- ⚠ **Three credibility checks, and each guards a way the split goes quietly wrong**: reduced motion
  (the star draws from mount, so phase A already contains it), phase A slower than B (the star solves
  negative), and a difference too small to be anything but jitter. Failing any of them logs
  `[pixels] split REFUSED` and falls back to one number for the whole frame.
- ⚠ **`starMilliseconds` WAS A LOWER BOUND, and none of the three checks could catch it. FIXED
  2026-08-13 — `SUN_MEASURE_BEGIN_EVENT`.** Both phases run before `SUN_ASSEMBLE_EVENT`, and
  `positionShards(0, 0)` at model-land had already set `visible = false` on every one of `coronaParts` —
  the core sphere, the outer glow and the twenty corona planes — with `sunParticles` collapsed into its
  launch knot. **Phase B was timing ten tumbling shards.** The corona is not part of the star's cost, it
  *is* the cost. The checks ask *is this a real difference*; they cannot ask *is this the star we are
  budgeting for*. The works field now brackets phase B with `SUN_MEASURE_BEGIN/END_EVENT` and the star
  draws its shipping pose — corona grown, both ring bands out — for exactly that span.
  ⚠ **Nothing hides it: `IntroSequence` leaves `.hero-sun-layer` at `autoAlpha: 0` until the finale**,
  so this early the canvas is already `visibility: hidden`. That is what lets it be measured **in its
  own context, on the default framebuffer, through the same programs and the same MSAA resolve the
  visitor gets** — an offscreen target would have timed *different shaders*, because three applies tone
  mapping only when the render target is null.
- ⚠ **Only the star may say whether it was measured properly**, and it says so through
  `noteStarMeasuredInShippingPose()` rather than through `SectionCostSplit`. The field dispatches the
  event but cannot know it was honoured — `SunModelCanvas` refuses the pose under reduced motion, before
  its model lands, and once the assembly is cued (where the star is on screen and a formed pose would
  flash). A refused pose allocates exactly as it did before, and the `ALLOCATED` log says which it got.
- ⚠ **That correction moved two caps, and it can move the star's ratio DOWN.** `STAR_RAISE_OVER_MODELS`
  was carrying two arguments and is now carrying one: bounding an inflated solve is done, compositing
  coherence remains, so **1.35 → 1.6**. And `sunCeiling()` no longer treats native as a hard cap when
  the pose was measured — a strong **1× panel** may supersample the star to `SUPERSAMPLE_CEIL`, which is
  the one machine class where `ceil` held the field to 1.0 and the star was pinned there with it.
  ⚠ The probe is still **not** the gate and never will be (eightfold spread across loads); the burn-in
  is a different instrument. ⚠ And expect the honest number to be *lower* than the biased one on a dense
  panel — the star had been over-allocated ~4× and the budget is simply being told the truth.
- **Two conservatisms, both deliberate, both the same direction**: `fieldMilliseconds` carries the
  fixed cost so scaling it over-charges the field; and the star is measured at full rate while through
  services and works it draws at `SUN_IDLE_STRIDE`. The second is also what makes the **hero** safe
  without its own measurement — there the star is at full rate, but the field is not drawing at all.
- ⚠ **The star having its own ratio is NOT a return to what `SunModelCanvas`'s header warns about.**
  The old `min(devicePixelRatio, 2)` had measured nothing while the renderer beside it had; this one is
  the remainder of a measured frame. The star still may not out-vote the field about how fast the
  machine is — it may only spend what the field did not need, and never more than
  `STAR_RAISE_OVER_MODELS` (1.35×) of what the models got. That cap earns its place twice: the solve it
  bounds is inflated (above), and past ~1.35× density a star composited over softer marks stops reading
  as sharper and starts reading as pasted on.
- ⚠ **The emergency valve moves BOTH ratios.** A drowning machine has to be able to put down the
  heaviest thing it is holding, and after allocation that may well be the star.
- **Read it on the console:** `[pixels] ALLOCATED` in the loader, then the `ratio` and **`sun ratio`**
  gauges per section. Those two numbers are the whole output of the system.

⚠ **The burn-in stopped refusing, and it had to.** Measured: `0 usable frames in 2545 ms`, and on
another load `0 in 15786 ms` — not a sampler bug, the loader simply had 15 long tasks totalling 4.7 s
running through it. It now waits for a quiet main thread and rejects *individual* insane frames instead
of abandoning the whole reading. It is the sole source of truth for both ratios now.

⚠ **`driftActive` and `assemblyFlightActive` are separate flags** (`SunModelCanvas`), and were one.
The drift is delta-timed idle tumbling with no authored landing — it must force a draw but must **not**
block a reallocation. It was true for the entire loader wait, so the star had no clear frame to apply
a new ratio on, and any allocation would have landed as a sharpness pop on the centrepiece
(`sunParticles` changes grain size with the ratio, so not a subtle one).

## Performance systems

These exist and are load-bearing — don't reinvent them:

| `lib/` | Job |
|---|---|
| `gpuProbe.ts` | Times **one real frame** of a real pipeline with a GPU drain either side of it. Used once, on the works field's warm-up render — a render that had to happen anyway, so the measurement is nearly free. |
| `adaptivePixelRatio.ts` | **The quality allocator** (`reportSectionCosts`, added 2026-08-07) plus the shared resolution. **Native by default; above native has to be EARNED — and the probe only sets the CAP, it never starts you there.** It used to land straight on the measured ceiling, and since the probe times one works frame on a quiet stage while the real frame also carries the sun, the compositor and the blend layers, that meant the controller walked the ratio back down on nearly every load. Starting at `min(ceiling, 1)` and letting the controller climb costs the same reallocation in the opposite direction — sharpening rather than giving up. Also runs a live controller on real frame times for the rest of the session. **Frozen during crossings** — reallocating a composer mid-flight causes a visible jump. ⚠ **A ratio is not a cost — `MAX_DRAWING_BUFFER_MEGAPIXELS` is.** `hardwareCeil` rises with `devicePixelRatio`, which is backwards: a 4K laptop at 250% scaling was handed ratio 2.0 *because* its panel is dense, drew 5.26 Mpx, put the render targets over 700 MB and ran at 20 fps. The budget caps the pixels the ratio actually implies. |
| `warmScene.ts` | Compiles a scene's programs **and uploads its maps** on an idle frame. Both halves are needed: `compile()` builds programs only, and three uploads a texture on first *draw*. ⚠ **It takes the render target the scene is drawn into, and getting that wrong makes the whole call a silent no-op** — three keys a program on the tone mapping and colour space implied by whatever target is bound WHILE IT COMPILES, so a compile on a bare rAF builds programs a composer will never ask for. ⚠ Two things it still cannot reach at all: a post-processing **pass** (its material lives on its own FullScreenQuad, in no scene) and a hidden object's **geometry**. Both need a real draw — see `warmUpField` and `warmSingularityWhenIdle` in `useWorksField`, which is also where the trap that a scene's **point light** rekeys every program in the scene is written down. |
| `assetLoadProgress.ts` | Weighted, monotonic combined progress from the `deck` and `works` sources, plus the shader-warmup gate. The intro's counter is honest because of this. **Re-weigh `SOURCE_WEIGHTS` if either side's assets change size — shrinking one invalidates them exactly as much as growing one.** |
| `useIsLowPowerViewport.ts` | Unmounts the hero's optional effects on phones, and **reacts to resize** — unmounting an effect is cheap and reversible. It is no longer the source of `lowPower`. |
| `deviceTier.ts` | **The one quality authority: `potato \| low \| mid \| high`, decided once at first ask and LATCHED.** Everything downstream of it allocates, so it must not change when a window is dragged. `isLowPowerDevice()` is the old `lowPower` boolean expressed in terms of it — the two scene hooks no longer compute their own. ⚠ It does not measure: `gpuProbe` runs during the works warm-up, long after every composer is allocated, so it cannot answer a question asked at construction. |
| `journey/` | **Visitor analytics — and ⚠ it is NOT telemetry.** `lib/telemetryEnabled`, `TelemetryConsole`, `LoaderTelemetry` and `cacheTelemetry` are diagnostics that print to a console and are compiled OUT of production. This is the opposite: it runs in production, for visitors, and posts to the studio's own panel. Two tiers — anonymous for everybody, a persistent id only on consent. ⚠ It **subscribes** to the site's existing CustomEvents; no scene, section or component imports anything from it. `docs/journey-analytics-plan.md` is the record for this repo AND the panel. |
| `modelLoading.ts` | The page's ONE Draco decoder and ONE KTX2 transcoder. Both are shared because each instance fetches its own ~250/585 KB decoder and spins its own worker pool, and **neither is ever disposed** — `dispose()` terminates those workers, so whichever scene unmounted first would break decoding for every scene still alive. ⚠ `detectKtx2Support(renderer)` is separate and mandatory: `KTX2Loader.load()` throws if it has never seen a renderer, and two of the four model loaders (`chamberScene`, `singularityScene`) deliberately never get one. ⚠ `THREE.Cache` must stay OFF — the header says what it breaks. |

**Every texture in every model is KTX2 (ETC1S)** as of 2026-08-04 — GPU-compressed, so it stays
compressed in VRAM instead of expanding to RGBA. ~169 MB of texture became ~38 MB at unchanged
resolution, and the download went *down* 5%. ⚠ **Not UASTC, even for normal maps**, which is the
textbook answer and costs ~970 KB per 1024² map against ~140 KB for ETC1S — unaffordable on a page
whose loader gate waits on a download. `scripts/buildModels.mjs` has the per-model escape hatch and
`docs/adaptive-asset-tier-plan.md` §10c has the four ways the encode failed silently first.

⚠ **The site DOES pick quality from a measurement now, and it is new** (2026-08-03). An earlier
revision of this file said the opposite, correctly at the time: a `performanceTier.ts` had classified
`'low' | 'high'` off `adaptivePixelRatio`'s own samples, was imported by nobody, and was deleted with
`getPerformanceSnapshot()` on 2026-08-02. **What exists now is not that design.** `performanceTier`
read the live controller's samples, which is circular — the controller had already acted on them.
`gpuProbe` takes ONE independent measurement before the first visible frame, and
`reportProbedFrameCost` solves a ratio from it (`probeRatio × √(budget ÷ measured)`). `lowPower` is
still a **viewport and pointer check** decided once at mount, and is a separate thing.

**The default is native.** Rendering above it costs 2.25× the pixels *and* 2.25× the render-target
memory through bloom and post; a machine has to measure fast enough to be allowed it. Guessing upward
and clawing back does not work, because the claw-back only happens after the expensive configuration
has already been allocated on the machine that could not afford it.

**Only one heavy 3D scene ever draws at a time past the hero** — the deck and the works field gate
each other off, and both stop on tab-hidden. Preserve that. ⚠ **The sun is the exception and always
has been:** it is demand-rendered but `covered` only goes true at the chamber reveal, so it draws
alongside the deck through services and alongside the field through works. Deliberate — the star
breathes and collapses across those spans, and the works backdrop is transparent behind it.

⚠ **`samples` on a composer target is paid TWICE.** `EffectComposer` clones the target it is handed
(`renderTarget2 = renderTarget.clone()`) and `RenderTarget.copy` carries `samples` across. A
full-resolution 4× MSAA HalfFloat target is ~83 MB on a 1512×982 panel at ratio 1, so a two-composer
scene at `samples: 4` is ~330 MB before anything else. Count them before adding one.

**Antialiasing, as it stands** (revised 2026-08-06; `docs/performance-cost-inventory.md` §6):

| composer | potato | low / mid / high | earned |
|---|---|---|---|
| works · **space** | 0 | **0** | **4**, from the burn-in |
| works · **screen** | 0 | 0 | — |
| deck | 0 + SMAA | 0 + SMAA | — |

⚠ **`low`/`mid`/`high` went 2 → 0 on 2026-08-06, and it was a PURCHASE, not a saving.** It paid for
`MAX_COMPOSITE_UPSCALE` 2.5 → 2.17, which raises the resolution floor 15 % — the only dial that can
lift quality on a machine whose burn-in lands under the floor, which on a 4K laptop at 250 % scaling
is every machine. See the rule immediately below, which this reverses.

⚠ **The `earned` column is now decided in the LOADER**, not four seconds into the fleet. It used to
require `hasEarnedExtraQuality()` — 50 fps held for four seconds — which by construction cannot be
satisfied before the first visible frame, so the raise was always a mid-session `dispose()` and
reallocation of both ping-pong targets on the first lap and never again. `reportBurnIn` now grants the
licence from its own measured surplus (`solved ÷ spent >= 1.25`).

⚠ **RESOLUTION IS THE PRIORITY; SAMPLES ARE THE LEFTOVER.** Below native the whole frame softens —
type, textures, every edge. Dropping MSAA only stair-steps geometric silhouettes, and SMAA covers much
of that for a fraction of the memory. **Nothing may trade resolution away to keep samples.**

That is enforced by *when* each is decided, not by a comment: `deviceTier` sets a floor that does not
include 4×, and the works field raises to 4 only once the **burn-in** has run and `adaptivePixelRatio`
has settled the ratio — so the samples come out of measured leftover headroom (the burn-in's own
surplus, `solved ÷ spent >= 1.25`). An earlier cut had `high: 4` at construction; a machine that
*looked* strong then allocated ~166 MB on a guess and paid for it by dropping resolution. That is the
same failure `adaptivePixelRatio`'s header records being rewritten to stop making.

- **works · screen is always 0.** For the whole of works it draws one pixel-aligned fullscreen quad
  carrying an already-resolved texture. Its `SMAAPass` is likewise enabled only for the chamber.
- ⚠ **works · space USED to say "can never be 0 above `potato`"** — because stage 2's SMAA is gated to
  the chamber, so this was the only AA the marks, debris and starfield got. **That is now 0 anyway**,
  deliberately, and the rule above it is what decides between them: spending samples to BUY resolution
  is *"resolution is the priority"* read forwards. What it costs is real and should be named — through
  the works BROWSING span the marks and debris have no geometric antialiasing at all. If that reads as
  harsh, **un-gate `smaaPass` for the browsing span** (~12 MB of lookup textures, no per-sample
  bandwidth) rather than putting the samples back.
- **The deck never earns MSAA**, deliberately: the probe is taken once, in the works hook, and reading
  it from here would usually work and occasionally not (on a cached reload both scenes warm on the same
  signal and the order is whichever effect registered first). AA that differs between two loads of the
  same page is worse than not having it. If it is ever wanted, give the deck its **own** probe — its
  warm-up already draws a real frame, which is what made the works one nearly free.

⚠ **A composer target with `samples` AND an `SMAAPass` is always a bug.** Both scenes had it; both hid
it in a comment claiming SMAA was "the only geometry AA on the final image". The **target** carried
the samples, not the renderer, which is why a grep never found it.

⚠ **`setSize` will not rebuild a target for a new sample count** — it only disposes when the DIMENSIONS
change. `samples` is read in `setupRenderTarget`, so raising it means `dispose()` on **both** of a
composer's ping-pong buffers.

Costs, roughly: WorksField + Chamber ●●●●● > ServicesDeck ●●●●○ ≈ FluidCursor ●●●●○ > sun ●●●○○.
`UnrealBloom` is the recurring expensive pass. Diagnosis of what actually made a laptop crawl — with
the numbers — is in `docs/lag-and-freeze-diagnosis.md`.

## Nothing is configurable at runtime

**Deleted 2026-08-02, deliberately and by request.** There are no authoring routes, no `?tune`, no
`lil-gui`, no knob schemas, no writable tuning handles.

⚠ This section used to end "One route ships: `/`", and that is no longer true — `/about` and
`/careers` shipped 2026-08-06. **The rule it was standing for is untouched**, and it was never about
the route count: no route on this site exposes a tuning surface, and neither of the new ones has a
single knob, query parameter or editor in it. They are content pages. Do not read them as a
precedent for bringing an authoring route back.

⚠ **One thing added since does write to `localStorage`, and it is not a tuning knob**: the journey
layer's consent record and its tier 2 visitor id (`lib/journey/consent.ts`, which owns both key names).
That is a visitor exercising a legal right, not anybody configuring the site — nothing it stores changes
how a single pixel renders. Do not read it as a precedent for persisting preferences.

What went: `/sun-lab` (the fractured-sun + black-hole editor), `/letters` and
`/letters/transition/[strategy]` (the glyph testbed and the mark→mark comparison rig),
`components/lab/**`, the chamber's `?tune` panel, `lib/tunerDock|tunerExport|tunerReset|tuneScrollLock`,
and the transition strategy registry/catalogue along with `shards`, the candidate that never shipped.
~10,900 lines. It is all in git if any of it is ever wanted back.

**Every value is now a named constant in the file that reads it**, and in most cases that file is the
only copy left:

| where | what it holds |
|---|---|
| `lib/chamberTuning.ts` | the room, the display rig, the showcase keys, the hologram |
| `ServicesDeck/deckTuning.ts` + `deckServices.ts` | the fleet's stage; the per-ship palettes |
| `WorksField/worksTuning.ts` | the camera path and where the mark sits |
| `WorksField/transitions/accretionTransition.ts` → `ACCRETION_TUNING` | the mark's ~60 look and choreography numbers |
| `Hero/SunModelCanvas.tsx` | the sun's Peaceful / Cracks / Collapse stages |
| `Contact/singularityScene.ts` | the collapse finale |

⚠ **Two pairs must not drift, and nothing enforces it any more.** `SunModelCanvas`'s COLLAPSE_* block
and `singularityScene`'s four geometry values are the same pose — the star you leave at works and the
star you come back to at contact. And `ACCRETION_TUNING`'s glow values were all graded against
`useWorksField`'s `BLOOM_THRESHOLD` of 0.6; moving that threshold re-grades the mark.

Many comments in those files explain a value by comparing it to what an editor showed, or by naming a
six-second round trip it was authored on. That history is worth keeping — but the editors are gone, so
read them as provenance, not as instructions to go and re-author something.

---

# PART 3 — Code style

## Naming

**Never abbreviate.** Every variable, parameter, destructured value and callback argument is named
for exactly what it is.

```ts
// ❌
const p = req.params;  const fn = (e: Event) => {};  const { s, t } = useScroll();
function animateParticles(p: ParticleConfig) {}

// ✅
const routeParams = req.params;  const handleSubmit = (event: Event) => {};
const { scrollProgress, scrollTarget } = useScroll();
function animateParticles(particleConfig: ParticleConfig) {}
```

**Files.** `.tsx` → PascalCase, named after the component it exports. `.ts` → camelCase: hooks are
verb-first (`useHeroAnimation.ts`), utilities/config/data describe their contents
(`measureUntransformedRect.ts`, `deckServices.ts`, `carouselLayout.ts`) — **never** `utils.ts` /
`helpers.ts` / `misc.ts`. If the name doesn't tell you what's inside, rename it.

**Hooks** are verb-first and action-describing. **Components** are PascalCase, named for what they
render.

## Exports

Pages & components → **default**. Hooks, utils, lib, types, registries → **named**.
`page.tsx` / `layout.tsx` → always default (required by Next).

## Comments

Comments explain **why**, or walk through the steps of complex logic. They should read like a human
wrote them — not generated documentation, not a narration of the obvious.

```ts
// ❌ Says what the code already says
brightness *= 1.5;   // Brighten the particle

// ✅ Explains the why
// Particles brighten as they lock in so the formed shape "pops" — this is what makes the
// reveal read as building, not just arriving
brightness *= 1.0 + gatherRaw * FORM_BRIGHTNESS_BOOST;
```

Number the steps in multi-step timelines and shaders. No JSDoc on every function — only where a
shared `lib/` helper is genuinely reusable and non-obvious.

**The codebase's comments carry hard-won traps** (composer buffer roles, transformed-rect
measurement, `transferControlToOffscreen` under StrictMode, the optimizer's `join`/`instance`
flags). When you fix something subtle, leave the reason behind.

## TypeScript

`interface` for object shapes, `type` for unions/computed. **No `any`** — use `unknown` and narrow.
Export shared contracts explicitly (`DeckService`, `WorksProject`, `CarouselLayout`, the `*Refs`
interfaces the hooks accept).

## Single responsibility

Every file has one job. A component renders UI and delegates animation to hooks. A hook manages one
concern. A shader file contains shader code — not scene setup, not React bindings. A config file
holds static values — not logic.

**Line count is a signal, not a rule.** A 300-line shader doing one thing well is fine; a 100-line
component doing both animation orchestration and layout is not.

## General rules

- **No magic numbers.** Named constants at the top of the file, never inline.
- No commented-out code in commits.
- Import order: external → `@/` aliases → relative.
- `'use client'` only where strictly necessary.
- **Three.js / WebGL is always dynamically imported** (`next/dynamic`, `ssr: false`) — it cannot run
  on the server.
- WebGL canvases render behind content and never block scroll or pointer events. (Exceptions: the
  deck canvas accepts drag; the works field accepts drag-to-look.)
- **Backticks inside a `/* glsl */` template literal terminate the string.** This has bitten twice,
  both times from a comment. Use plain words inside shader source.
- Every animation respects `prefers-reduced-motion` via `prefersReducedMotion()`.

## Verification

**The user runs the app.** Don't spin up a dev server or a browser to verify — run `npx tsc
--noEmit` and `npm run build`, self-review the diff, and hand off clearly stating what still needs
eyes on it.

---

# PART 4 — What is NOT built

Be accurate about this; the previous revision of this file was wrong in both directions.

| | |
|---|---|
| **Contact** | **BUILT, AND THE FORM POSTS NOW** (2026-08-13). `handleSubmit` sends to `/api/enquiry`, which forwards to the panel's `POST /api/submissions` holding `VOIDIX_CMS_INTAKE_SECRET` — see `lib/cms/panelIntake.ts` for why the route exists at all rather than the browser posting direct. ⚠ It lands in an **inbox**, not the leads pipeline: a submission becomes a contact only when an admin promotes it, so a bot or a "hi" never reaches the counts. **Still placeholder:** every address, social handle and legal route in `contactContent.ts` is invented. The navbar is fully wired: all four items and the CTA route through `GOTO_SECTION_EVENT`. |
| **Process content** | **The section is now called FAQ** (renamed 2026-08-05, key and label both — it was `process` everywhere). The chamber's content was always the FAQ hologram, and a key that said `process` was describing an intention rather than the room. The hologram's list now ends in an **Ask us anything** control that opens the shared enquiry panel with no prefill. **Still open:** the decided-but-unbuilt idea that process steps appear on the chamber's walls as the camera tours. |
| **The collapse finale** | **BUILT** — ported into `components/sections/Contact/singularityScene.ts`, a SECOND star living inside the works renderer (the hero sun's canvas has no compositor and nothing behind it for lensing to bend). Collapse, flash, black hole, accretion and lensing all ship. See `docs/contact-singularity-plan.md`. |
| **Real content** | `worksProjects.ts` and `faqEntries.ts` are both explicitly placeholder — and since 2026-08-14 `worksProjects.ts` is a **fallback** rather than the source: real projects and their marks are uploaded in the panel. The deck ships 4 services; the brief names 6. The fallback marks are still three stock SVG logos, plus one project deliberately left with none so the **initial** fallback is visible in the shipped data; a letter mark extrudes in **helvetiker, not Syne** (`markBody.ts` says why — `marks.ts` is gone). `careersContent.ts`'s four roles are likewise invented — and there they are the **template for the dashboard**, see below. |
| **Careers content** | **DASHBOARD-MANAGED AND CONNECTED** (decided 2026-08-11, wired 2026-08-13). `app/careers/page.tsx` is a Server Component on **ISR** — `fetchPublishedContent()` → `resolveCareersContent()`, with `careersContent.ts` as the fallback when the panel has published nothing or is unreachable. Section 02 renders an honest **empty state** when the list is empty; ⚠ an empty published list must NEVER fall back to this repo's four invented roles, and `PublishedCareers.roles` says why. The application form is `EnquiryForm variant="application"` — name\*, email\*, and **the work** (a link and/or one PDF ≤ 5 MB, at least one of the two, checked in JS because `required` cannot express "either"), split across **two steps** since 2026-08-16 so it fits every frame without scrolling. It posts multipart to `/api/application`, which uploads the PDF to UploadThing server-side and files the rest with the panel against the role's **`slug`** — never its title, which an editor can rewrite. ⚠ **The steps are a layout, not two requests**: one `<form>`, one `FormData`, one submit from step 02 carrying every field. |
| **Attribution** | `black_hole.glb` is *"Black Hole" by NestaEric*, CC-BY-4.0. **Now credited**, in the contact footer — the first place on the site that puts the model on screen. No link to the source page: the licence does not require one and none was to hand. |
| **CMS wiring** | **9 of 9 payload keys read.** ⚠ This row said "2 of 9" long after it stopped being true. `lib/cms/siteContent.ts` resolves every key, split so the document routes never carry the scene sections' copy (`resolveSharedContent`) and `/` and `/lite` get the lot (`resolveFullContent`). `lib/cms/contentReport.ts` prints per-key provenance in dev — read that rather than trusting this table. `docs/cms-integration-plan.md` §③. |
| **Journey analytics** | **BUILT, 2026-08-17; completed 2026-08-19.** Visitor analytics into the studio's own panel — no third party. `lib/journey/` collects by subscribing to the site's own events, `/api/journey` holds the secret, the panel stores and reports at `/user-activity`. Two consent tiers: tier 1 needs no permission and stores nothing on the device, tier 2 adds one id. GPC is honoured as a denial. **Outstanding: nothing has been seen end to end**, and ⚠ `voidix-cms/prisma/scripts/journey-maintenance-cron.sql` must be RUN once per database or `/privacy`'s ninety-day retention is a claim nothing performs. `docs/journey-analytics-plan.md`. |
| **Search visibility** | **NOT BUILT, and measured 2026-08-13.** No `sitemap.ts`, no `robots.ts`, no canonical, no JSON-LD of any type, no OG image. ⚠ `metadataBase` is still a **guess** at the post-rebrand domain and carries a TODO — every relative canonical and OG URL resolves against it. ⚠ And the homepage's markup is the bigger problem: **0 `<h1>` elements** (the hero is a `div` with `role="heading"`, DOM text `"we build W rlds"`), **1 service description in 4**, **1 project in 4**, and **0 FAQ answers** — the render is a ternary, list *or* one answer. `/lite` carries all of it and is deliberately `noindex`. Numbers and the fix order in `docs/cms-integration-plan.md` §④–⑥. |

⚠ **Many of this file's `docs/*.md` citations point at files that are not in the tree.** They are real
history — they are in git — but do not send anyone to a path without checking it exists first. What IS
in the tree, as of **2026-08-19**:
`adaptive-asset-tier-plan.md`, `cleanup-plan.md`, `cms-integration-plan.md`,
`fluid-cursor-leak-plan.md`, `journey-analytics-plan.md`, `mobile-polish-plan.md`,
`next-steps-plan.md`, `per-section-quality-budget-plan.md`, `performance-audit.md`,
`performance-cost-inventory.md`, `reverse-loop-plan.md`, `route-arrival-plan.md`,
`sun-mobile-quality-plan.md`, `sun-plasma-plan.md`, `unused-inventory.md`,
`works-marks-cms-plan.md`.

⚠ **`npm install` before `npm run build` on a fresh checkout of `feat/cms`.** `uploadthing` was added
to `package.json` in `305b396` without being installed; the build dies on
`Can't resolve 'uploadthing/server'` and the error names a module, not a missing install.
