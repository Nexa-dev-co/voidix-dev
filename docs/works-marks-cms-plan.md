# Works marks from the CMS — plan of record, 2026-08-14

The panel gains a **file upload** on each project. An editor uploads an SVG, it lands in Supabase
Storage, and the URL travels in the published payload. The **site's server** turns that URL into SVG
source while rendering, so every mark is already in hand when the loading screen starts and the works
field cuts it into the accretion body. A project with **no** uploaded mark falls back to its own
**initial**, extruded as a letter.

The panel can **add, remove, reorder and edit projects freely**. The field is no longer four.

---

## Status — BUILT, 2026-08-14

Both repos. `npx tsc --noEmit` clean on each; `npm run build` exit 0 on each (site: 10/10 static
pages, CMS: full route table). Everything in §6 is done except the two measurements, which need the
app running and are listed under "what still needs eyes" below.

**Three things changed from the plan as written, each because reading the code contradicted it:**

1. ⚠ **The stroke-only failure is not "zero shapes", it is a filled blob.** Corrected in §3 with the
   loader line numbers. It moved a fix onto the SITE (`svgToShapes` now skips `fill: none`) that the
   plan had entirely inside the panel.
2. ⚠ **SSRF is closed at the source, not just at the prefix check.** The panel never accepts a mark
   URL — `resolveMarkChange` *generates* one from the storage path it just wrote. The site's prefix
   lock is now defence in depth rather than the only defence.
3. ⚠ **Uploads go through a server action, not browser-direct.** Same outcome, better property: the
   file is validated *before* it is stored, and "an admin of this panel" stays expressed once in code
   instead of being re-expressed in a Storage RLS policy. `lib/content/markUploads.ts` has the
   reasoning.

**Verified numerically rather than asserted:** `buildProjectViewKeys` was compiled standalone and
checked for stop-0 identity, one ascending stop per project, every stop inside the cone, and the
adjacent-gap bound, across 1–12 projects. Worst adjacent gap 31.2°. At four stops it returns the
authored array **by identity**, so today's site is unchanged.

---

## Decisions, made before this was written

| | |
|---|---|
| **Storage** | Supabase Storage. The CMS already has Supabase wired end to end — auth, SSR client, service-role key — so a public bucket is one migration and no new vendor. |
| **Transport** | Upload → URL in the payload → **the site dereferences it on the server, during ISR**. The browser is handed the SVG source and never sees the storage host. |
| **Count** | Variable. The panel owns how many projects exist. |
| **No mark** | The project's initial, via the existing `letter` path. Never a blank, never a repeated logo. |

### ⚠ Why the browser never fetches the mark itself

The first cut of this plan had the loader fetch each mark from its public Supabase URL. That is
wrong, and the reason is already written in this repo — `lib/cms/panelIntake.ts` gives it as a design
benefit of proxying intake through our own routes:

> *"The panel's URL never appears in the page, so the address of the studio's leads database is not
> public knowledge."*

A public Storage URL is `https://<project-ref>.supabase.co/storage/v1/object/public/marks/…`. Putting
that in the page publishes the project ref of the CRM database to every visitor. It leaks no
credential — the ref and the anon key are already public on the panel's own login page, and
`content_releases` is RLS deny-all with the anon grants revoked — but it advertises where the leads
database lives, which is precisely what the intake proxy exists to avoid.

**Resolving on the server keeps the whole design and removes the exposure.** The panel still has a
file upload, Supabase Storage still holds the file, the payload still carries a URL. Only the
dereference moves. What that buys, beyond the leak:

- **no new public surface** — the alternatives were a proxy route (a new unauthenticated endpoint,
  and an open proxy unless it maps an opaque id to a known object) or a second storage vendor with a
  second write token in a second repo;
- **CORS stops being a question**, because no cross-origin fetch happens;
- **the loader loses N round trips instead of gaining them** — the marks are in hand at mount;
- the size cap and content-type check are enforced **before the bytes reach any browser**.

⚠ **The one risk it adds is SSRF, and it is why the prefix lock is not optional.** Fetching a stored
URL server-side is a vector if that URL is attacker-controlled. The CMS gates it on save (§3 ②), and
**the site must re-check the prefix before fetching** rather than trusting the payload — the payload
crossed a network to get here.

Remaining accepted cost: **a release is not quite a complete snapshot.** `content_releases` holds a
URL, so replacing a file rewrites what an old release renders. The window is now bounded by ISR
rather than being open forever, and if it ever bites, the migration is small: the field becomes
`markSvg` text and the panel stores the file's contents instead of a link. The editor's experience is
identical either way.

---

## 1 · What exists today

```
  worksProjects.ts          marks.ts              prepareMarks.ts           accretionChunks.ts
  ────────────────          ────────              ───────────────           ──────────────────
  WORKS_PROJECTS[4]         MARKS[4]              fetch(mark.source)        buildAccretionChunks(
   markId: 'signal'  ──id──► id/kind/source       → svgToShapes             shapes, flipY, …)
   markId: 'compass'         '/logos/*.svg'         SVGLoader.createShapes    triangulate
   markId: 'shield'          or a glyph             (FILLS ONLY)              → partition into stones
   markId: 'initial'  ──────► kind:'letter','V'   → letterToShapes          → crystals on the rim
        │                                                │                        │
        └──── length pinned to 4 by resolveWorksProjects ─┘                        │
                                                                                   ▼
                                              useWorksField.buildMark(), inside the loader gate
                                              — awaited before the section reports ready
```

Three things this plan leans on, all already true:

- **Nothing about a mark is compiled in.** `prepareMarks.ts:44` is a plain `fetch` of a string, and
  everything downstream takes `THREE.Shape[]`. Handing it source text that came from elsewhere is a
  smaller change than it looks — the seam already exists.
- **Scale is already solved.** `markCapMesh` measures source bounds first, so the shipped marks
  having viewBoxes of 95, 149 and 97 units costs nothing. An arbitrary editor SVG normalises to
  `markTargetSize` like any other. The Y-flip is carried per mark as `flipY`.
- **The letter path is built and working.** `letterToShapes` + `/fonts/helvetiker_bold.typeface.json`
  (61 KB, already shipped). Project 04 uses it today. ⚠ It is **helvetiker, not Syne** — `marks.ts`
  explains why, and the fallback initial will read generic by construction. That is a known,
  documented compromise, not a new one.

### What is per-project and structural

Exactly two things. Everything else about a project is words.

| | owner today | after this plan |
|---|---|---|
| the mark | `markId` → `MARKS` registry → `public/logos/` | the panel, as an uploaded file |
| **the camera stop** | `PROJECT_VIEW_KEYS` — **4 hand-authored poses** | **generated from N — see §2** |

---

## 2 · ⚠ The blocker: the camera path is hand-authored, and it has four stops

This is the one part of "the panel can add a project" that is a design problem rather than plumbing.

`worksTuning.ts` holds a 7-key spline: 4 stops and 3 pass-through transits, each pose composed by
hand — alternating high/low, left/right, with its own field of view.

```
                    transit bulges out to ~8.6        (from above, +Z toward the viewer)
                          ,--- 1 ---.        ,--- 5 ---.
                         /           \      /           \
                stop 1  2             \    4  stop 2     6  stop 3
                +28deg   \             \  /  -25deg         -35deg
                          0  stop 0      3
                          0deg (FIXED)   transit, pulled back and low
```

A fifth project has **no pose**. And two invariants constrain whatever replaces this:

1. ⚠ **Stop 0 must equal `FLIGHT_LANDING_KEY` exactly** — `(0, 1.0, 7.0)`, fov 38, derived from where
   the services→works flight actually leaves the camera. Move it and the handoff ends with a visible
   jump. Non-negotiable, and the file says so.
2. ⚠ **Neighbouring keys stay inside ~35°.** The spline interpolates *cartesian* position, not polar
   angle, so a wide gap cuts a chord through the circle and the camera dives at the mark mid-hop.
3. Every **stop** stays within ~35° of face-on, because the body is a 0.7-thick slab — a logo seen
   edge-on is a bar.

### The generator

Replace the literal array with `buildProjectViewKeys(stopCount)`, which emits stop poses and the
transits between them:

```
  stop i:     yaw   = alternating sign, magnitude spread across the legible cone
              y     = alternating high / low
              radius= 5.8 … 7.6
              fov   = 36 … 44, varied so no two stops are the same composition
  transit:    yaw   = midpoint of its neighbours
              radius= ~8.6  (pulled back)
              fov   = +4…6  (wider)
```

⚠ **The acceptance test is that `buildProjectViewKeys(4)` reproduces today's array.** Keep the
authored 7 keys in the file as `REFERENCE_PATH_FOUR` and assert the generator matches it within an
epsilon under `telemetryEnabled`. Without that, this change silently re-composes the four shots the
section already has.

⚠ **There is a practical ceiling and it should be stated, not discovered.** Stops must all sit inside
a ~70° cone, so spacing is `70/(N−1)` degrees: 23° apart at N=4, 14° at N=6, 10° at N=8. Past roughly
**6 stops the compositions start repeating** — the plan is to lean harder on elevation, radius and
fov as N grows, and to have the panel warn above 8 rather than to pretend it scales forever.

**This is the largest single item in the plan.** If it needs to be deferred, marks-from-the-panel at a
fixed four still ships on its own and is useful on its own — but add/remove does not.

---

## 3 · Requirement one: it must be an SVG

Three layers, because each catches something the others cannot.

### ① In the panel, at file selection — the one that catches the real trap

⚠ **CORRECTED 2026-08-14, after reading the loader rather than assuming it.** An earlier draft of
this plan said a stroke-only SVG "yields zero shapes". **It does not, and the truth is worse.**
`SVGLoader.parseNode` pushes every geometry element onto `paths` regardless of fill — `fill: 'none'`
only skips setting a colour (line 231) — and the parse is seeded with `{ fill: '#000' }` (line 1976),
so `style.fill` is never `undefined`. `svgToShapes` then calls `createShapes` on **every** path.

A stroke-only icon therefore renders as **filled blobs of its own outlines**: an outlined circle
becomes a solid disc. Nothing is empty, so no fallback fires, and the section shows a wrong body
with no error anywhere.

**Two changes follow, and the first is on the site.**

⚠ **`svgToShapes` must skip paths whose resolved `style.fill` is `'none'`.** That is what makes a
mixed SVG render its fills and ignore its stroke decoration, and — the point — what makes a
stroke-only file yield genuinely zero shapes so the **initial fallback fires** instead of a blob. A
wrong mark becomes a graceful one. ✓ Verified safe for the three shipped logos: none contains
`fill="none"`, none has a stroke, none has a `<style>` block, so this is a no-op for them.

The panel's check is then exact: **a file is usable iff at least one path resolves to a fill other
than `'none'` and yields at least one shape.**

So the check runs in the browser, in `ProjectForm`, the moment a file is chosen, using **the same
loader the site uses**:

```
  file chosen
      │
      ├─ extension .svg  +  type image/svg+xml  +  size ≤ 256 KB
      ├─ XML parses, root is <svg>, has a viewBox
      ├─ no <script>, no <foreignObject>, no external href/xlink
      └─ dynamic import SVGLoader → parse → createShapes
              │
              ├─ 0 shapes  → "This SVG has no filled shapes. Outline strokes and re-export."
              └─ N shapes  → preview + "N shapes · ready" and enable upload
```

`three` is a heavy import, so it is a **dynamic import inside the change handler**, on that one route
only — the panel is an admin tool and pays this once per upload, not on load.

### ② On save, server-side — the layer that cannot be bypassed

The client check is advice; this is the gate. In `createProjectAction` / `updateProjectAction`:

- the URL must sit under **our own Supabase Storage public prefix**, so a project cannot point the
  site's loader at an arbitrary host;
- fetch it and confirm `content-type: image/svg+xml` and the size cap;
- re-run the XML-level element gate (`<script>`, `<foreignObject>`, external refs).

The shape-count check is deliberately **not** repeated here — it needs a DOM, Node has no
`DOMParser`, and adding jsdom to the CMS to re-answer a question the browser already answered
exactly is not worth it. ② stops a hostile or broken URL; ① stops a useless one.

### ③ On the site — never trust it anyway

`prepareMarks` already treats a mark that fails as absent. That policy gets **better** under this
plan: a fetch that 404s, times out or yields no shapes now falls back to the project's initial rather
than dropping the mark. See §5.

⚠ **The uploaded SVG is untrusted markup.** On the site it is fed to `SVGLoader.parse` and never
enters the DOM, so the surface is small. **The panel's preview is where it would bite** — render it
as `<img src>` or a data URI, never inline.

---

## 4 · Requirement two: fetched during loading, ready for the section

Requirement met by construction, and more cheaply than today: with the dereference on the server, the
marks are **already in the browser's memory before the loader starts**. There is nothing left to
fetch during loading.

```
  SERVER (ISR, 600 s)                    │  BROWSER
  ───────────────────                    │  ───────
  fetchPublishedContent()                │
    → payload with N markSvgUrl          │
  resolveFullContent()                   │
    → prefix-check each URL              │
    → fetch each, in parallel, capped    │
    → source text, or null               │
         │                               │
         └─ props ──────────────────────►│  SiteContentProvider
                                         │      │
                                         │      ▼
  intro / loader ────────────────────────┼──────────────────────────► reveal
   deck assets ─────────────►            │                            │
   works: debris texture ───► 0.45       │                            │
          MARK OUTLINES ────► 0.55  ← now pure PARSE, no network      │
          strategy surfaces ► 1.0        │                            │
          cut every mark ───►       ← one frame yielded per mark      │
                                      buildField awaits buildMark
                                      before reporting the section ready
```

`buildMark()` is awaited by `buildField()` before works reports ready, and the intro's gate waits on
that — so marks were already guaranteed present before the section was reachable. That guarantee is
unchanged; what changes is that the 0.45 → 0.55 stage stops being network-bound and becomes CPU only.

The server-side resolve:

- **Parallel**, `Promise.all` across the projects, with a per-fetch timeout. It runs during ISR, so
  the cost is paid once per revalidation window, not once per visitor.
- ⚠ **Prefix-locked before the fetch.** A URL that does not sit under our configured storage prefix
  is not fetched at all — see the SSRF note in §Decisions. The payload crossed a network; it is not
  trusted input.
- ⚠ **It must never throw**, matching `fetchPublishedContent`'s contract. A mark that 404s, times out
  or exceeds the size cap resolves to `null`, and `null` becomes the project's initial. The panel
  being down must not take the homepage with it.
- **Size cap enforced here too**, not only in the panel — this is the last point before the bytes
  become part of a page.
- **`SOURCE_WEIGHTS.works` is 0.16**, weighted when the marks were four local files fetched in the
  browser. They are no longer fetched in the browser at all, so that share is now smaller than it was;
  `assetLoadProgress.ts`'s header already says to re-weigh when either side's assets change.

⚠ **RSC payload cost.** The source ships in the HTML: ~1 KB per mark (the three shipped logos are
688, 1154 and 1455 bytes) on `/` and `/lite` only — the document routes resolve `sections: null`, so
`/about` and `/careers` carry none of it. `siteContent.ts` split the payload precisely to protect
that property; keep marks inside `SiteSections` so the split keeps holding.

⚠ **The cut cost is now variable and nobody has ever measured it.** `buildAccretionChunks` runs per
mark with `capSubdivisions: 2` — each subdivision quadruples triangles — and the strategy has
measured itself since the day it was written while `useWorksField`'s own comment notes **nothing has
ever read the result**. With N fixed at four that was a curiosity. With N editable it is a budget.
**Take that measurement first** (§6 step 0); it is one `console.log` that already exists.

---

## 5 · The mark becomes 1:1 with the project, which deletes an indirection

Today: `markId` → find in the prepared array → index. The indirection exists precisely because a
failed mark is *dropped*, which by position would shift every later project onto its neighbour's
logo.

With a per-project mark and an initial fallback, **a project can never fail to have a mark**. So
`prepareMarks` returns exactly one entry per project, in order, and `markIndexOfProject` becomes the
identity. The registry in `marks.ts` and the `markId` field both go.

```
  for each resolved project:
      markSvg source?  ──yes──► svgToShapes ──≥1 shape──► SVG mark
              │                      │
              │              0 shapes ┘
              └──no (null: never uploaded, refused the prefix check,
                     404, timed out, or over the cap) ──┐
                                                        ▼
                                       letterToShapes(initialOf(title), font)
```

⚠ **The source is already text by the time `prepareMarks` sees it** — the fetch happened on the
server. This function no longer touches the network, which is what makes the fallback branch above a
pure decision rather than a race.

Notes on the initial:

- ⚠ **The font is now always needed.** `prepareMarks` loads it only `if (MARKS.some(kind ===
  'letter'))`; any project may need it at any time, so load it unconditionally and treat a font
  failure as the one case where a mark really is absent.
- `initialOf(title)` takes the first character of the trimmed title, uppercased. Non-Latin titles
  will not be in helvetiker's glyph set — `generateShapes` yields nothing, which lands back in the
  "no mark" branch. Worth a panel hint rather than an error.

---

## 6 · The work, in order

**Step 0 — measure the cut.** Read `strategy.metrics.buildMilliseconds` on a real load. Everything in
§4 about a ceiling on N is a guess until this number exists. One load, no code.

**Step 0b — decide the storage prefix and put it in the environment.** One value, read by both sides:
the panel validates uploads against it and the site refuses to fetch anything outside it. Nothing
else in this plan is safe to build before that constant exists.

### voidix-cms

1. **Migration + bucket.** `marks` bucket, public read, authenticated write. `Project.markSvgUrl
   String?` and `Project.markStoragePath String?` — the second so replacing or deleting a mark can
   remove the old object rather than orphaning it.
2. **`ProjectForm` upload control.** Browser-direct to Storage with the authenticated session, so no
   bytes pass through the Next server and the CMS's "no file reaches this app" principle survives.
   Validation ① inline, with the shape count and a preview.
3. **Server gate ②** in `createProjectAction` / `updateProjectAction`.
4. **`contentPayload.ts`**: `markSvgUrl: string | null` on `PublishedProject`.
5. **Correct the two stale notes**: `model Project`'s "renders with the global fallback rock" (untrue
   — see below) and `works/page.tsx`'s "Four fires." warning, which changes meaning once the heading
   is count-driven.

### orbix-dev

6. **`publishedContent.ts`**: mirror `markSvgUrl`. ⚠ Same sitting as step 4 — two repos, one JSON
   document, nothing enforcing it.
7. **`worksProjects.ts`**: `markId` → `markSvgUrl?: string | null`. ⚠ **Delete the length guard in
   `resolveWorksProjects`** and stop merging positionally onto `WORKS_PROJECTS` — the published array
   becomes the spine, and the repo array is only what a disconnected clone shows. This is the
   semantic centre of the change.
8. **`lib/cms/markSource.ts`** (new): the server-side dereference. Prefix-check → parallel fetch with
   timeout and size cap → source text or `null`. Never throws. Called from `resolveFullContent` so
   `WorksProject` arrives carrying `markSvg: string | null`, and the scene routes are the only ones
   that pay for it.
9. **`prepareMarks.ts`**: takes the resolved projects; parses the source it is handed; initial
   fallback; always load the font. **No network.** `marks.ts` is deleted.
10. **`worksTuning.ts`**: `buildProjectViewKeys(stopCount)` + `REFERENCE_PATH_FOUR` assertion (§2).
11. **`useWorksField.ts`**: accept `projects` in `FieldOptions`; the three `WORKS_PROJECTS` uses
    (lines 1548, 1620, 3077) become the passed list; `markIndexOfProject` collapses to identity.
    ⚠ The setup effect is persistent by design — read the projects at effect start and note that they
    cannot change mid-session, which is true because they are server-resolved.
12. **`FieldCanvas.tsx`**: pass `projects` through.
13. **`Hero.tsx`**: `projectCount` from `useSiteSections()`, not `WORKS_PROJECTS.length`. This is what
    makes the pin's stop count follow the panel.
14. **`jumpDestinations.ts`**: module-scope constants → a function of the live counts.
15. **`WorksField.tsx`**: the hardcoded **"Four fires."** `<h2>`. Count-driven or generic; the panel
    must not be able to make it lie.
16. **`contentReport.ts`**: the projects count-mismatch branch goes away.

---

## 7 · Corrections this plan makes to the written record

- ⚠ `docs/cms-integration-plan.md` §`projects` says *"a project added in the panel renders with the
  fallback mark"*. **It does not.** `resolveWorksProjects` sees `length !== 4` and discards the whole
  payload — every project reverts to repo copy. Step 7 removes the guard and makes the doc's claim
  true for the first time.
- ⚠ The CMS's `model Project` comment says a new project *"renders with the global fallback rock"* and
  that *"several text-only additions will read as the same body repeated"*. That describes the
  **meteor era**, before the accretion strategy — the body is the mark now, and after this plan a new
  project renders **its own initial**, which is distinct per project.
- `CLAUDE.md` PART 4 still says "2 of 9 payload keys read". It is 9 of 9.

---

## 8 · What is deliberately not in here

- **Syne for the initial.** `marks.ts` has the standing note: three ships helvetiker, and the brand
  face is a hashed `.woff2` that needs new tooling to convert. The fallback initial reads generic
  until someone drops a Syne `.ttf` into `public/fonts`. Out of scope, unchanged by this.
- **Per-project camera authoring.** The generator gives every project a composed shot. Letting an
  editor *choose* a shot is a different feature and would put camera poses in a copy database.
- **`/work/[slug]` project pages.** Already deferred in the integration plan until the projects are
  real. Untouched.
