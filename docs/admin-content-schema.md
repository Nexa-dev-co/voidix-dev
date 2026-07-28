# Admin Content Schema — the editable text

> Audit date: **2026-07-28**. Source of truth is the code, not this file — if they disagree, the code
> wins and this doc is stale.

Scope for the admin panel: **text only**. Every field below is a string or a list of strings.

**Deliberately excluded** — these stay in code and are not CMS fields: model paths (`.glb`), hull
palettes and PBR material values (`profile`), per-ship light overrides (`light`), model rotations,
stage/camera/pad tuning (`deckTuning.ts`), and project rock geometry (`rock`). Most of those are
authored through the in-app `?tune` GUI panel, which writes back to source files; putting them in a
database would mean two tools fighting over the same values. See §5 for what that exclusion costs.

**There is no Process section.** The navbar renders a `Process` item pointing at `#process`
(`Navbar.tsx`), but no section with that id exists. The spec that described it,
`docs/works-to-process-boarding.md`, is marked SUPERSEDED — the concept was dropped before it was
built. What occupies that slot is the **Chamber → FAQ hologram** (§3). So the three content-bearing
sections are Services, Works, and FAQ.

---

## 1. Services

**File:** `components/sections/ServicesDeck/deckServices.ts` → `DECK_SERVICES`
**Rendered by:** `ServicesDeck.tsx` · **Current count:** 4

| Field | TS type | DB type | Notes |
|---|---|---|---|
| `index` | `string` | *derived* | `"01"`, `"02"`… Store `sort_order INT` and format it. Never an editor input — it must stay contiguous and match array position. |
| `name` | `string` | `varchar(80)` | Short display name in the bottom carousel strip, e.g. `"Web Experiences"`. Keep it short — it sits in a four-across row. |
| `eyebrow` | `string` | `varchar(120)` | Poetic kicker above the description, e.g. `"Interfaces with escape velocity"`. |
| `description` | `string` | `text` | One paragraph. Plain text — **no markdown, no HTML**. |
| `capabilities` | `string[]` | ordered child table | Tag chips under the description. Currently always 4; the layout tolerates a few more. Order matters. |

---

## 2. Works

**File:** `components/sections/WorksField/worksProjects.ts` → `WORKS_PROJECTS`
**Rendered by:** `WorksField.tsx` · **Current count:** 4 — all placeholder copy, per the file's own header

| Field | TS type | DB type | Notes |
|---|---|---|---|
| `index` | `string` | *derived* | `"01"`. Shown in the `01 / 04` counter. Derive from `sort_order`. |
| `title` | `string` | `varchar(80)` | Codename / display title, e.g. `"Aphelion"`. |
| `client` | `string` | `varchar(120)` | Who it was built for, or the context, e.g. `"Private markets desk"`. |
| `year` | `string` | `varchar(8)` | **String, not integer.** Rendered raw as `{client} · {year}`. Keep it a string unless you change the component. |
| `description` | `string` | `text` | One paragraph, plain text. |
| `tags` | `string[]` | ordered child table | Capability/tech chips. Order matters. |

---

## 3. FAQ

**File:** `components/sections/Chamber/faqEntries.ts` → `FAQ_ENTRIES`
**Rendered by:** `Chamber/FaqHologram/FaqHologram.tsx` · **Current count:** 7

The cleanest section to put behind a CMS — pure text, zero 3D coupling, and the hologram measures its
own content so the frames move to fit. **The list length is genuinely free.**

| Field | TS type | DB type | Notes |
|---|---|---|---|
| `index` | `string` | *derived* | `"01"`–`"07"`, shown down the left of each row. Derive from `sort_order`. |
| `question` | `string` | `varchar(200)` | |
| `answer` | `string[]` | ordered child table | **An array of paragraphs**, each rendered as its own `<p>`. Not markdown. The editor needs a repeatable-paragraph input, or split a textarea on blank lines. Long answers scroll inside the hologram rather than growing it. |

---

## 4. Headings and nav — text, but not addressable yet

This copy is hardcoded in JSX. It's all text and all in scope, but **it has to be extracted into data
files before a CMS can reach it**.

| Location | Content |
|---|---|
| `ServicesDeck.tsx` | `"The Fleet"` · `"One craft at a time." / "Bring it online."` |
| `WorksField.tsx` | `"Selected Work"` · `"Four fires." / "One field."` |
| `FaqHologram.tsx` | `"Frequencies"` (list eyebrow) · `"all questions"` (back link) |
| `Hero.tsx` | `"we build worlds"` · `"software with its own gravity"` |
| `Navbar.tsx` | `NAV_ITEMS` labels/numbers · CTA label `"Start Project"` |
| `heroReadouts.ts` | `CORE_MODULES` — hero telemetry HUD labels/values (`"Building Worlds"`, `"Online"`, …) |

Section titles use an explicit `<br/>`, so model them as `title_line_1` / `title_line_2` — not one
string with a newline.

Two exceptions that are text on the surface but structural underneath:

- **The hero headline is effectively not editable.** The word "worlds" is split into `W` + the shared
  3D sun (standing in for the "o") + `rlds`, and `IntroSequence` flies that sun out of the loader
  wordmark into that exact slot. Changing the word means re-choreographing the intro handoff.
- **`NAV_ITEMS` labels are safe to edit; the `key` field is not.** Each key maps to a scroll-progress
  meter and the CSS var its section feeds (`--nav-progress-<key>`), and `services` is intercepted in
  `handleNavClick` to dispatch `GOTO_SERVICES_EVENT` rather than navigating.

---

## 5. What add / remove actually means per section

This is where "text only" has consequences. The three sections are **not** equally free, because a
service and a project are each attached to a 3D object that text alone doesn't describe.

### FAQ — fully free ✅

Add, remove, reorder, any length. The hologram measures its own content and the frames move to fit.
Nothing else to supply.

### Works — add and remove work, with one visual caveat ⚠️

`rock` is **optional** in the type. A project that omits it falls back to the tuner's global
`meteorSeed` / `meteorColor` / `meteorTextureRepeat`. So a text-only project renders fine.

The caveat: *every* project without a rock gets the **identical** fallback rock. The section's premise
is that each project is a different body you fly to, so two or three text-only additions in a row
will read as the same rock three times. Adding projects works; making each one look distinct still
needs a dev to author a `rock`.

Removing and reordering are safe — nothing is positionally coupled on the works side.

### Services — edit only, no add ❌

A service **is** a vessel. Adding one needs a `.glb` uploaded, `npm run optimize:models` run for
Draco compression, a `profile` palette authored, and placement/scale/rotation dialled in through
`?tune`. None of that is text, and there is no fallback vessel — a service without a `modelPath` has
nothing to render.

**Reordering and deleting are also unsafe as the code stands.** `deckTuning.ts` holds
`ships: ShipPlacement[]` built as `DECK_SERVICES.map(...)` — **indexed by position, not by id** — and
each `hiddenParts` entry is a string of the form `"<shipIndex>:<meshIndex>"`, so the index is baked
into the data. Reorder or delete a service and every placement silently binds to the wrong vessel.
Nothing throws; the ships just sit wrong.

If you want reorder/delete for services, the prerequisite is a code change: move `ShipPlacement` onto
the service record and key `hiddenParts` by service id instead of array position.

**Recommendation:** ship the services panel as **edit-text-only, fixed order, fixed count**. Treat
adding a service as a dev task.

---

## 6. Suggested table layout

```
services
  id, sort_order, name, eyebrow, description

service_capabilities
  id, service_id FK, sort_order, label

projects
  id, sort_order, title, client, year (varchar), description

project_tags
  id, project_id FK, sort_order, label

faq_entries
  id, sort_order, question

faq_paragraphs
  id, faq_entry_id FK, sort_order, body

section_copy            -- §4, once the headings are extracted from JSX
  id, section_key, eyebrow, title_line_1, title_line_2
```

Ordered child tables for `capabilities` / `tags` / `answer` rather than `jsonb` arrays, because all
three are ordered and individually rendered — a child table gives you that ordering at the DB level.
`jsonb` is defensible if you'd rather not join.

Every excluded field (model path, profile, light, rock, placement) stays in its current source file.
The records above join to them **by `sort_order`/array position today** — which is exactly the
coupling described in §5. Giving each service a stable `slug` that the code keys off is the change
that makes the CMS safe to reorder later.

---

## 7. Gotchas

1. **Counts are dynamic in code but hardcoded in prose.** `craftCount` and `projectCount` come from
   `.length` (`Hero.tsx`), the works counter renders `WORKS_PROJECTS.length`, and FAQ length is free
   — so the mechanics handle new items. But the works heading literally says *"Four fires"*. Adding a
   fifth project makes the heading wrong. Adding items also lengthens the single pinned scroll for
   every visitor.

2. **Everything is a compile-time TypeScript import today.** These arrays are consumed by Three.js
   scene builders during WebGL init, not fetched at runtime. Moving to a database is a choice between
   build-time fetch (ISR — preserves the current zero-runtime-cost model) and client fetch (needs
   loading states threaded through scene init). Given the performance bar in `CLAUDE.md`,
   **build-time is the right default**; "publish" in the admin panel triggers a revalidate.

3. **No rich text anywhere.** Every string renders as plain text into a styled element. If an editor
   pastes markdown or HTML, it will display as literal characters. Either strip it on save or add a
   renderer — don't leave it to chance.

4. **Length limits are real, not defensive.** `name` sits in a four-across carousel row, `eyebrow` is
   one line, and section titles are two fixed lines. These are cinematic layouts with no reflow
   safety net. Set `maxlength` in the admin UI and preview at a narrow viewport.
