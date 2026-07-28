# Voidix Admin Panel — Restructure, Plan & Operations

> **Written:** 2026-07-28 · **Branch:** `feat/monorepo-content-package` · **Status of step 1:** done, staged, not committed
>
> Voidix is becoming two deployed surfaces: the public site at **voidix.tech** and a hand-built
> control panel at **admin.voidix.tech** that edits what the site shows. This document covers three
> things: exactly what changed in the repo to make that possible, the full plan through deployment,
> and how to run and ship both apps.
>
> **Read this before touching `packages/content`.** The reason the content arrays are mutable rather
> than fetched is subtle and load-bearing — it's in [2.4 The hydration seam](#24-the-hydration-seam).

---

## 1. Why this exists

Until now every piece of copy on the site was a TypeScript literal. Changing a service description
meant editing `deckServices.ts`, committing, and redeploying. That's fine for a developer and
useless for anyone else.

The complication is that Voidix's "content" is not blog posts. It's three different kinds of thing
tangled into the same objects:

| Kind | Example | Who should edit it |
|---|---|---|
| Copy | `name`, `eyebrow`, `description`, `capabilities`, `question`, `answer` | Anyone |
| Identity | `modelPath`, `profile.accent`, `light.color`, `rock.color` | Someone with taste |
| Physics | `emitThreshold`, `clearcoatRoughness`, `iridescenceIOR`, `gradeMid` | Someone who can see the scene |

**The decision taken was to expose all three in the panel**, including the shader tuning. That is
deliberate and it is the ambitious option — a wrong number in the third row visibly breaks a scene
in production. Two mechanisms exist specifically to make that safe, and neither is optional:
**draft/published separation** and **version history with rollback** (see [Step 5](#step-5--tuning-to-the-database)).

---

## 2. What changed — the step 1 restructure

Nothing about how the site looks or behaves changed. This step was entirely about creating a seam.

### 2.1 Repo layout

**Before** — a single Next.js app at the repo root.

**After** — a pnpm workspace with two members:

```
voidix/
  package.json              # workspace root; scripts delegate into apps/web
  pnpm-workspace.yaml       # packages: apps/*, packages/*
  docs/                     # unchanged, still at root
  CLAUDE.md  AGENTS.md  PRODUCT.md  README.md

  apps/
    web/                    # the entire previous root, moved verbatim
      app/  components/  lib/  public/  scripts/
      next.config.mjs  tailwind.config.ts  postcss.config.js
      eslint.config.mjs  tsconfig.json  package.json

  packages/
    content/                # the shared content definition (step 1)
      src/
        index.ts            # the public surface
        types.ts            # the contract
        validation.ts       # zod schemas for untrusted input
        runtime.ts          # the live arrays + hydrateContent()
        defaults/
          deckServices.ts
          worksProjects.ts
          faqEntries.ts

    database/               # the database layer (step 2)
      src/
        index.ts
        rows.ts             # snake_case table shapes
        mappers.ts          # row ↔ domain, validating on the way out
        client.ts           # service-role client, server-side only
        scripts/seed.ts     # seeds from @voidix/content

  supabase/                 # the schema itself (step 2)
    README.md               # how to apply, seed and verify
    migrations/*.sql
```

The move used `git mv`, so **history follows every file** — including the three content files, which
moved from `components/sections/**` into `packages/content/src/defaults/`. About 160 of the changed
paths are pure renames.

### 2.2 Package names

| Path | Package name |
|---|---|
| repo root | `voidix` (private, not published) |
| `apps/web` | `@voidix/web` |
| `packages/content` | `@voidix/content` |
| `apps/admin` | `@voidix/admin` *(step 4, does not exist yet)* |

### 2.3 `packages/content` — the four files

**`types.ts`** — the contract. `DeckService`, `GradedProfile`, `LegacyProfile`, `ShipProfile`,
`ShipLight`, `ModelRotation`, `WorksProject`, `ProjectRock`, `FaqEntry`, plus a new `ContentPayload`
(one published snapshot of all three collections, every field optional so a partial publish doesn't
blank the others).

These are the *same interfaces that already existed*, moved with their doc comments intact. Nothing
was redesigned.

**`validation.ts`** — a zod schema per interface, each written as
`z.object({...}) satisfies z.ZodType<Interface>`. That annotation is the point: drop a field from
one side and **the package stops compiling**. The schemas are deliberately tighter than the
interfaces, because a form is about to be writing this data:

- colours must match `/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/` — `THREE.Color` silently renders black
  on anything it can't parse, which is invisible in a form and obvious on the page
- PBR factors are clamped to `[0, 1]`; `iridescenceIOR` to `[1, 3]`
- `emitStrength` / `envIntensity` are non-negative but *not* clamped to 1 — they drive bloom and
  routinely exceed it
- `modelPath` must match `/^\/models\/[\w.-]+\.glb$/`
- `index` must be a two-digit ordinal; `year` a four-digit string
- `rock.sizeScale` is held to `[0.5, 1.5]` so the meteor keeps reading as the same body

**`runtime.ts`** — the live arrays the site reads, and `hydrateContent()`. See below.

**`defaults/`** — the content as authored in code. This is simultaneously the seed for the database
and the fallback when nothing is published, so it stays a complete shippable fleet, not a stub. The
exports were renamed `DECK_SERVICES` → `DEFAULT_DECK_SERVICES` etc.

### 2.4 The hydration seam

**This is the part that matters.** Content on this site is consumed *synchronously at
module-evaluation time*:

```ts
// components/sections/ServicesDeck/deckTuning.ts — runs the moment the module loads
ships: DECK_SERVICES.map(restingShip),
```

The Three.js scenes also read the arrays entirely outside React. Turning any of that into `await`
would mean rewriting the scene bootstrap. So we don't. Instead:

```ts
export const DECK_SERVICES: DeckService[] = structuredClone(DEFAULT_DECK_SERVICES);

export function hydrateContent(payload: ContentPayload): void {
  if (payload.services) replaceListInPlace(DECK_SERVICES, payload.services);
  // …projects, faqEntries
}
```

`replaceListInPlace` **empties and refills** the array rather than reassigning it. This is the exact
contract `lib/tunerReset.ts` already documents for tuning objects:

> *"Every scene holds its tuning BY REFERENCE — that reference is the whole mechanism."*

Replace the array and every existing holder — `deckTuning`, the scene hooks, the tuner panel — keeps
pointing at the old one, and hydration appears to do nothing.

`hydrateContent()` is currently **called from nowhere**. The arrays start as the bundled defaults and
stay there, which is why the site behaves identically. Step 3 is where a server component starts
feeding it.

Validation deliberately does **not** happen inside `hydrateContent`. It belongs at the trust boundary
where untrusted input arrives, and keeping zod out of `runtime.ts` is what keeps it out of the public
site bundle.

### 2.5 What did *not* change

The three original paths are now five-line shims:

```ts
// apps/web/components/sections/ServicesDeck/deckServices.ts
export { DECK_SERVICES } from '@voidix/content';
export type { DeckService, GradedProfile, /* … */ } from '@voidix/content';
```

So **all ten consumer files are untouched**: `Hero.tsx`, `ServicesDeck.tsx`, `useServicesDeck.ts`,
`deckTuning.ts`, `deckTunerPanel.ts`, `hullMaterial.ts`, `WorksField.tsx`, `useWorksField.ts`,
`FaqHologram.tsx`. Keep those shims — deleting them means touching ten files for no benefit.

### 2.6 Supporting config changes

| File | Change | Why |
|---|---|---|
| `apps/web/next.config.mjs` | `transpilePackages: ['@voidix/content']` | The package ships raw TypeScript, no build step |
| `apps/web/package.json` | name → `@voidix/web`, added `@voidix/content: workspace:*`, added `typecheck` | Workspace wiring |
| `packages/content/package.json` | `sideEffects: false` | Lets the site's bundler drop zod entirely |
| `.gitignore` | un-anchored `node_modules/`, `.next/`, `out/`, `build/`, `temp/`; added `.turbo/`, `.impeccable/` | The old `/node_modules` only matched at the root and would have stopped matching once the app moved |
| `apps/web/scripts/optimizeModels.mjs` | header comment | Its relative paths now resolve against `apps/web`, so raw sources belong at `apps/web/models-src` |
| root | deleted `package-lock.json` | Both an npm and a pnpm lockfile were committed. One lockfile, and it's pnpm's |

### 2.7 New dependency

**zod 4.4.3**, in `packages/content` only.

`CLAUDE.md` says no validation library without being asked. This was asked and approved, on the
grounds that a custom panel writing to Postgres needs runtime validation at the trust boundary, and
one shared schema is what stops the admin saving a shape the scenes can't render.

**It does not reach the public site.** Verified by grepping the built client chunks — no zod
internals, no schema error strings. `sideEffects: false` shakes it out.

### 2.8 Verification performed

| Check | Result |
|---|---|
| `pnpm --filter @voidix/content typecheck` | clean — every schema provably matches its interface |
| `pnpm --filter @voidix/web typecheck` | clean |
| `pnpm build` | clean; route table unchanged; homepage First Load JS **166 kB** |
| SSR HTML contains all three collections | `Web Experiences`, `Aphelion`, `What do you actually build` all present |
| zod in client chunks | absent |
| `/?tune`, `/sun-lab` | 200 |

**Not verified:** `next start` against the production build (a dev server was running concurrently
and overwrote `.next` with dev artifacts — an artifact collision, not a code problem), and the
`?tune` lil-gui panels opening visually, which needs a browser.

---

## 3. The plan

| # | Step | State |
|---|---|---|
| 1 | Monorepo + `packages/content` + hydration seam | **done** |
| 2 | Schema (content, tuning, leads), `packages/database`, seeder | **done** — needs a project to run against |
| 3 | Site reads Supabase; publish → revalidate → live | **done** |
| 4 | `apps/admin` — auth + CRUD for copy + publish | **done** — needs a staff user to sign in |
| 4b | Contact form on the site + leads inbox in the panel | independent |
| 5 | Tuning into the database, draft/publish, version history | |
| 6 | Live preview so tuning is judged by eye | |
| 7 | Two Vercel projects + DNS | |

Steps 1–4 already give a shippable panel. Steps 5–6 are the ambitious half and can land later
without blocking anything.

**4b is deliberately unnumbered-in-sequence.** Lead capture shares nothing with the content pipeline
except the database — it flows the other direction, has its own security model, and touches none of
the hydration or publish machinery. It can land any time after step 4 (or before step 5), and
slipping it doesn't block anything else.

### Step 2 — Supabase schema — **built**

The migrations live in [`supabase/migrations/`](../supabase/migrations/) and the operational guide —
how to apply them, how to seed, how to verify — is [`supabase/README.md`](../supabase/README.md).
This section is the reasoning.

> **Two revisions to the sketch that was here originally.** Both were wrong in ways that only showed
> up while writing the SQL, and both are corrected below and in the migrations.

**Content → draft tables plus published snapshots.** *(revised: not a per-row `status`)*

The original sketch gave every content row `status: draft | published`. That's wrong, because **the
unit of publishing is the collection, not the row.** The site loads every service in one request, so
a per-row flag lets a visitor catch a half-published fleet — three services updated, the fourth still
showing last week's copy.

So: `services`, `projects` and `faq_entries` are the **working draft**, always editable, invisible to
the public. `content_publications` holds one row per publish containing a complete `ContentPayload`
snapshot, and that is the only thing the site reads. This buys atomic publishes, version history and
rollback for free (re-publish an older row), and lets the site validate one blob with the
`parseContentPayload` that already exists.

`profile`, `light` and `rock` stay `jsonb` inside the draft tables, because they're art direction with
a shape that moves whenever a shader changes.

**Ordinals are derived, not stored.** `DeckService.index` ("01") comes from an item's place in the
sorted collection at map time. Storing it separately is how you get the item at position 0 labelled
"03". Note it's derived from *place in the sorted collection*, not from the raw `position` value —
positions go non-contiguous as soon as anything is reordered.

**Tuning → jsonb, with draft and published in separate tables.** *(revised: not two columns in one row)*

The blob decision stands: the shape changes every time a shader is tuned, and `sunLabStorage.ts`
already has `normalizeState` to absorb that drift — reuse the idea rather than migrating per tweak.

What changed is where the draft lives. The obvious design is one row with `draft_data` and
`published_data`, with the site reading the published column through a view. **That can't be secured:**
Postgres RLS is row-level, not column-level, so any policy letting `anon` read the published column
also exposes the draft. Hiding it behind a view only works if the view bypasses RLS — the exact
footgun worth avoiding.

So `scene_tuning` (draft, staff-only), `scene_tuning_published` (anon-readable), and
`scene_tuning_versions` (history, staff-only) are three tables with three different grants. Nothing
the public can reach ever contains work in progress.

A scene absent from `scene_tuning_published` has simply never been published, and the site keeps the
values compiled into its bundle — which is why an unseeded database renders a correct site.

**Leads → the one table that flows the other way.** Everything above is written by the panel and read
by the site. Leads are the reverse: **written by the public site, read only by the panel.** That
inversion changes the security model completely, so it gets its own treatment below.

```sql
create extension if not exists citext;   -- case-insensitive email

create table leads (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),

  -- What the visitor typed. Columns rather than jsonb because these are the fields you sort,
  -- search, dedupe and email from.
  name         text   not null,
  email        citext not null,
  message      text   not null,
  company      text,

  -- Everything else the form asks (budget band, timeline, project type, how they found us).
  -- jsonb because the contact form will grow fields, and a lead is a record of what was asked
  -- at the time — old rows must stay readable after the form changes, without a migration.
  payload      jsonb not null default '{}',

  -- Attribution + spam triage. Never store a raw IP: hash it with a server-side salt so you can
  -- still spot "forty submissions from one source" without holding personal data.
  source_path  text,
  referrer     text,
  ip_hash      text,
  user_agent   text,

  -- The sales pipeline. Nothing to do with content's draft/published — do not reuse that column.
  status       text not null default 'new',
    -- new | read | replied | qualified | won | lost | spam
  notes        text,                          -- internal; never leaves the panel
  handled_by   uuid references auth.users,
  handled_at   timestamptz
);

create index leads_created_at_idx on leads (created_at desc);
create index leads_status_idx     on leads (status);
create index leads_email_idx      on leads (email);
```

**RLS — the whole access model.**

| Table | `anon` (the public site) | `authenticated` (staff) |
|---|---|---|
| `services`, `projects`, `faq_entries` | **nothing** | everything |
| `content_publications` | select | everything |
| `scene_tuning` (draft) | **nothing** | everything |
| `scene_tuning_published` | select | everything |
| `scene_tuning_versions` | **nothing** | everything |
| `leads` | **insert only** | everything |

```sql
-- Published snapshots: the one thing the world may read.
create policy "public reads publications" on content_publications
  for select to anon using (true);

-- Drafts: no anon policy at all, so unpublished copy can't leak even by accident.
create policy "staff manage services" on services
  for all to authenticated using (true) with check (true);

-- Leads: the world may INSERT and nothing else.
create policy "anyone may submit a lead" on leads
  for insert to anon with check (true);
create policy "staff manage leads" on leads
  for all to authenticated using (true) with check (true);
```

There is deliberately **no `select` policy for `anon` on `leads`**. Without one, nobody holding the
public anon key can read a single lead — not even the row they just submitted. Get this wrong and
your entire client list is one `curl` away, because `NEXT_PUBLIC_SUPABASE_ANON_KEY` is public by
design and ships in the browser bundle.

Three consequences worth writing down before the form is built:

1. **`.insert().select()` will fail.** The `select()` half has no policy. Insert and return nothing;
   the thank-you state comes from the request succeeding, not from the row coming back.
2. **Submit through a Server Action or Route Handler on voidix.tech, not from the browser.** Validate
   with zod server-side first. The anon key still can't read anything, so the worst case if it's
   abused is junk rows — not exfiltration. That's why the anon key is the right key here and the
   service-role key is not: least privilege, and the service-role key must never be in the web app
   at all.
3. **Rate-limit and add a challenge.** A public insert endpoint gets found. A honeypot field plus
   Cloudflare Turnstile plus a per-`ip_hash` rate limit is the cheap version; without it the `spam`
   status will be doing a lot of work.

**PII.** Leads are personal data — names, emails, whatever people type into a message box. They must
never appear in a preview deployment, a seed script, a fixture, or a log line. Decide a retention
period and write a scheduled delete for `status in ('spam','lost')` rather than keeping everything
forever.

**Where the lead types live:** *not* in `@voidix/content` — a lead is not content, and folding it in
would make that package's name a lie. When the form is built, add a sibling `packages/leads` holding
the submission schema (the site validates against it) and the record schema (the panel renders from
it). Same `satisfies z.ZodType<…>` discipline.

**Seeding — built.** `pnpm seed` (`packages/database/src/scripts/seed.ts`) imports
`DEFAULT_DECK_SERVICES`, `DEFAULT_WORKS_PROJECTS` and `DEFAULT_FAQ_ENTRIES` from `@voidix/content`
and inserts them, then writes publication version 1 so the site has something to read immediately.
Importing the real defaults rather than re-typing them as SQL means there's never a second copy to
drift.

It refuses to run against a non-empty `services` table without `--force`, since nothing here has a
natural key to conflict on and a second run would duplicate every row.

**Not seeded:** `leads` (starts empty in every environment) and `scene_tuning` — the tuning defaults
still live in `apps/web`, and a package can't import from an app. Moving those shapes into a package
is part of step 5; until then the site uses the tuning compiled into its bundle.

### Step 3 — the site reads the database — **built**

```
Server Component  →  fetchPublishedContent()        apps/web/lib/publishedContent.ts
                  →  parseContentPayload()          zod, server-side only
                  →  hydrateContent()               fills the SERVER's arrays
                  →  <ContentBoot payload={…}>      fills the BROWSER's arrays
                  →  render
```

**Read path.** `lib/publishedContent.ts` is a plain `fetch` of the `current_content` view rather than
supabase-js. The whole read is one row, and going through `fetch` means Next's cache handles it: the
homepage stays **statically generated** (still `○ Static` in the build output) and is invalidated on
demand by tag. It also keeps the Supabase client library out of the site bundle entirely.

Every failure path returns `null`, meaning "use what's compiled in": missing credentials, unreachable
database, empty table, or a payload that fails the schema. A content problem degrades the site to its
bundled defaults; it never takes the page down. The file is marked `server-only`, so importing it
from a client component is a build error rather than a silent undefined.

**The hydration problem, and why `ContentBoot` exists.** The server and browser run separate module
graphs and each hold their own copy of the arrays in `@voidix/content`. Hydrating on the server alone
makes the HTML right, then React replaces it with the compiled-in values — the page visibly flips
from published copy back to whatever shipped in the build. Both sides must be filled.

`ContentBoot` hydrates **during render, not in an effect.** `deckTuning.ts` reads `DECK_SERVICES` at
module-evaluation time to size its per-ship placements, and an effect runs too late — worse, racily,
since child effects run before parent effects and the dynamic import fires during a child's mount.
Render order is the one hard guarantee: a parent's render body always precedes its children's. This
works today only because `DeckCanvas` is `next/dynamic` with `ssr: false`, so `deckTuning` lives in a
chunk that loads *after* first render. **If that ever becomes a static import, hydration stops being
early enough.**

**Server-side mutation is safe only because content is global.** Every visitor gets the same
published payload, so concurrent requests can't disagree. Preview mode (step 6) serves a per-request
draft and must not reuse this path.

**Proven end to end.** Because the seeded data is byte-identical to the bundled defaults, a matching
page proves nothing — so the read path was verified by publishing a marked version, confirming the
cache held, calling the webhook, and watching the page change:

| | |
|---|---|
| baseline | `Web Experiences` |
| publish v2 to the database | page unchanged — cache holding |
| `POST /api/revalidate` (wrong secret) | `401` |
| `POST /api/revalidate` (correct) | `{"revalidated":true,"tag":"content"}` |
| page | `DATABASE PROOF` |
| publish v3 restoring the copy + revalidate | `Web Experiences` |

The marker appeared **twice** in the response — once in the rendered HTML and once in the RSC flight
payload — confirming the browser receives the payload too, so hydration doesn't revert it.

**`CLAUDE.md` is now definitively wrong**: the site has an API route (`POST /api/revalidate`), reads
a database, and every path in that file is off by `apps/web/`.

### Step 4 — the admin app — **built**

`apps/admin`, a Next.js app on port 3001. Borrows the site's tokens so it reads as the same product,
but it's a tool: dense, flat, no WebGL, no scroll choreography.

**No service-role key, and no browser Supabase client.** Staff sign in as real Supabase users, so
their requests arrive as `authenticated` — which the policies already grant everything. The
service-role key would only add the ability to bypass those policies, and a key that can read every
lead is worth not having in a web app at all. Every read is a Server Component and every write a
Server Action, so nothing Supabase-related reaches the browser and neither variable needs a
`NEXT_PUBLIC_` prefix.

**Auth.** `middleware.ts` refreshes the session on every request and redirects signed-out visitors to
`/login`, preserving where they were headed. It uses `getUser()` rather than `getSession()` — the
latter trusts the cookie, the former verifies it against the auth server, and in the thing deciding
who gets in that distinction matters. The redirect is convenience, not security: RLS is what actually
protects the data, so even a page rendered past the middleware would have nothing to show.

**Draft and publish are separated in the UI, not just the schema.** Editing writes to the working
tables; the live site doesn't move until someone presses publish on the overview. Every editor says
so.

**Publish validates before inserting.** `publishContent` runs `parseContentPayload` — the same
function the site runs on the way in — and refuses to write a snapshot that fails. Publishing an
invalid payload and letting the site reject it would revert the whole site to its bundled defaults
over one bad row. Revalidation is deliberately *outside* that: if the webhook fails the publish still
happened, and reporting it as a failure would tempt someone into publishing again and stacking
duplicate versions.

| Route | |
|---|---|
| `/login` | email + password; the same error whether the address is unknown or the password is wrong |
| `/` | draft counts, what version is live, and the publish button |
| `/services` | copy + vessel assignment for the four craft |
| `/projects` | work entries, capped at `MAX_WORKS_PROJECTS` |
| `/faq` | questions, uncapped |

**Two Next.js constraints worth remembering:** a `'use server'` module may only export async
functions, which is why `ActionState` / `IDLE_STATE` live in `lib/actionState.ts`; and `@supabase/ssr`
doesn't export the shape its `setAll` callback receives, so it's spelled out in both
`lib/supabaseServer.ts` and `middleware.ts`.

#### The project cap — enforced at three levels

You chose "make the panel refuse to exceed the authored stop count". It's enforced in three places
because the UI alone can be walked around:

1. **`packages/content/src/limits.ts`** declares `MAX_WORKS_PROJECTS`, with the reason written down —
   a limit whose rationale isn't recorded gets "fixed" by raising it.
2. **`contentPayloadSchema`** caps the projects array, so a publish carrying too many is rejected with
   a clear message. This matters even for rows added directly in Supabase: the alternative is the site
   failing validation at read time and silently reverting *everything* to bundled defaults.
3. **`worksTuning.ts`** counts its own authored stops and **throws at module load** if the two numbers
   disagree, in either direction. Add a camera stop without raising the constant and the panel stays
   too strict; raise the constant without authoring a stop and the site refuses to start rather than
   shipping a scroll position the camera can't reach.

The panel also disables the "Add a project" button at the limit and explains why — that adding one
means recording a new camera stop in the scene, which is a developer job rather than a settings
change.

### Step 4b — contact form and leads inbox

Two halves on two domains, sharing only the `leads` table and `packages/leads`.

**On voidix.tech** — the contact section (not built yet). The form posts to a Server Action or Route
Handler which validates with zod, derives `ip_hash` / `referrer` / `source_path` server-side rather
than trusting the client, verifies the Turnstile token, and inserts. It returns success or a field
error map — never the created row, which RLS wouldn't let it read back anyway.

The form is the last thing a visitor touches after the whole scroll, so it carries the same bar as
the rest of the site: submitting should feel like part of the experience, not a Google Form bolted to
the end. Optimistic state, a real success moment, and errors that appear inline without dumping the
message they just typed.

**On admin.voidix.tech** — the inbox. A list sorted by `created_at desc`, filterable by `status`,
with a detail view holding the full `payload`, internal `notes`, and the pipeline transitions. Marking
something `spam` or `lost` should be one click, because triage that takes effort doesn't happen.

**Notification is an open decision.** A lead nobody sees for three days is worse than no form. The
options, cheapest first: Supabase Database Webhook → an email service (Resend); a scheduled digest;
or polling in the panel (don't). Whatever you pick, the notification must not contain the message
body — send "a new lead arrived" and a link, so the PII stays behind the login.

### Step 5 — tuning to the database

Not a from-scratch build. The authoring workflow already exists — `?tune` panels mutate live tuning
objects, `tunerExport.ts` serialises them, `sunLabStorage.ts` persists a versioned document with
snapshots. **What's being replaced is the "copy the JSON, paste it into a TS file, redeploy" step.**

On the site, applying remote tuning is one call before the scene initialises:

```ts
restoreInPlace(DECK_TUNING, tuningFromDatabase);
```

Non-negotiable here, given tuning is fully exposed:

1. **Draft/published split** — the site reads published; the panel edits a draft.
2. **Version history** — you will break a scene at 1am and need one-click rollback.

### Step 6 — live preview

Tuning can only be judged by eye — `worksTuning.ts` says as much about the camera path. The admin
opens `voidix.tech/?preview=<token>` in an iframe, and that request reads the draft instead of the
published rows.

### Step 7 — deploy

See [section 6](#6-deployment).

---

## 4. Running locally

### First time

```bash
pnpm install          # from the repo root — installs every workspace member
```

If you previously used npm here: the npm lockfile is gone and `node_modules` was rebuilt by pnpm.
Delete any stale `node_modules` you find and re-run the above.

### Day to day

| Command | What it does |
|---|---|
| `pnpm dev` | **both** apps — site on **:3000**, panel on **:3001** |
| `pnpm dev:web` / `pnpm dev:admin` | one at a time |
| `pnpm build` | production build of the site |
| `pnpm build:admin` / `pnpm build:all` | the panel, or both |
| `pnpm start` | serve the production build (stop `pnpm dev` first — they share `.next`) |
| `pnpm lint` | lint the site |
| `pnpm typecheck` | typecheck **every** workspace member |
| `pnpm seed` | seed Supabase from the bundled defaults (`-- --force` to wipe and reseed) |
| `pnpm verify` | assert the data landed **and** that the RLS rules actually hold |
| `pnpm optimize:models` | Draco compression; sources at `apps/web/models-src` |

All of these are root scripts that delegate with `pnpm --filter`. You can also work inside an app
directly (`cd apps/web && pnpm dev`) — same result.

> **`pnpm build` then `pnpm start` will fail if a dev server is running.** Both write to
> `apps/web/.next`, and dev artifacts clobber the production server chunks. Stop dev first.

To touch only the shared package:

```bash
pnpm --filter @voidix/content typecheck
```

There is no build step for `@voidix/content` — it ships raw TypeScript and Next transpiles it, so
editing it is picked up by the dev server immediately.

### Once `apps/admin` exists (step 4)

Two servers on two ports. Add to the **root** `package.json`:

```json
{
  "scripts": {
    "dev": "pnpm --parallel --filter @voidix/web --filter @voidix/admin run dev",
    "dev:web": "pnpm --filter @voidix/web dev",
    "dev:admin": "pnpm --filter @voidix/admin dev"
  }
}
```

> The `--parallel --filter … --filter … run <script>` shape is verified working in this workspace.
> Keep the explicit `run` — dropping it is less reliable across pnpm versions.

and pin the admin's port in `apps/admin/package.json`:

```json
{ "scripts": { "dev": "next dev -p 3001" } }
```

| Surface | Local | Production |
|---|---|---|
| site | http://localhost:3000 | https://voidix.tech |
| panel | http://localhost:3001 | https://admin.voidix.tech |

**Subdomains locally:** Chrome and Safari resolve `*.localhost` automatically, so
`http://admin.localhost:3001` works with no hosts-file edit and exercises the real cross-subdomain
cookie behaviour. Firefox needs a `127.0.0.1 admin.localhost` line in your hosts file.

### Environment variables

Per app, never committed (`.env*.local` is already ignored).

`apps/web/.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=…
NEXT_PUBLIC_SUPABASE_ANON_KEY=…
REVALIDATE_SECRET=…              # shared with the admin, guards /api/revalidate

# lead capture (step 4b)
LEAD_IP_SALT=…                   # server-side salt for ip_hash — rotating it breaks dedupe history
NEXT_PUBLIC_TURNSTILE_SITE_KEY=… # public by design
TURNSTILE_SECRET_KEY=…           # server-side verification
```

`apps/admin/.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=…
NEXT_PUBLIC_SUPABASE_ANON_KEY=…
SUPABASE_SERVICE_ROLE_KEY=…      # server-side only — never NEXT_PUBLIC_
REVALIDATE_SECRET=…
SITE_URL=http://localhost:3000   # where to send revalidate + preview
```

The service-role key bypasses RLS. It belongs only in the admin, only server-side, and never in a
variable prefixed `NEXT_PUBLIC_`. **The web app never gets it** — that's what keeps a bug in the
public site from being able to read the leads table.

---

## 5. Working in this repo now

- **Editing content in code** → `packages/content/src/defaults/`. Still the fallback and the seed.
- **Editing the content contract** → `types.ts` *and* `validation.ts`. The `satisfies` annotation
  makes the compiler force you to do both.
- **Editing a scene** → unchanged, `apps/web/components/sections/**`.
- **Changing the schema** → a new timestamped file in `supabase/migrations/`, never an edit to an
  applied one. Then update `packages/database/src/rows.ts` and the mappers to match.
- **Row shapes stay inside `packages/database`.** If a component ever imports `ServiceRow`, the
  snake_case vocabulary has leaked — it should be taking a `DeckService`.
- **Adding a dependency** → `pnpm add <pkg> --filter @voidix/web` (or `@voidix/content`). Adding it
  at the root only makes sense for tooling that runs across the whole workspace.
- **New shared code** → a new `packages/*` member. Only promote something when a second app needs it.

---

## 6. Deployment

### Shape

One repo, **two Vercel projects**, distinguished by their Root Directory setting.

| Vercel project | Root Directory | Domain |
|---|---|---|
| `voidix-web` | `apps/web` | `voidix.tech`, `www.voidix.tech` |
| `voidix-admin` | `apps/admin` | `admin.voidix.tech` |

Both build from the same commit on the same branch. Vercel detects `pnpm-workspace.yaml` and installs
from the workspace root, so `@voidix/content` resolves normally.

### Per-project settings

- **Root Directory** — set as above. Confirm *"Include files outside of the Root Directory in the
  build"* is enabled; without it the build can't see `packages/content`.
- **Install Command** — leave as default. Vercel runs `pnpm install` at the workspace root.
- **Build Command** — default (`next build`) is usually correct with Root Directory set. If a build
  can't resolve the workspace package, override with
  `cd ../.. && pnpm --filter @voidix/web build`.
- **Node version** — match local (Node 25 here; set 22+ in project settings).
- **Ignored Build Step** — optional but worth it once both apps exist, so a copy-only change to the
  admin doesn't rebuild and re-deploy the 52 MB site. Vercel's `turbo-ignore`, or a script checking
  `git diff` against `apps/<name>` and `packages/`.

### Environment variables

Set the same keys listed in [section 4](#environment-variables) in each Vercel project, per
environment (Production / Preview / Development). The admin's `SITE_URL` becomes
`https://voidix.tech`.

Nothing secret goes in a `NEXT_PUBLIC_` variable — those are inlined into the client bundle and
readable by anyone.

### DNS

At your registrar for `voidix.tech`, add the records **Vercel shows you** in each project's Domains
tab — don't copy IPs from documentation, they change:

| Record | Host | Points at |
|---|---|---|
| A (or ALIAS/ANAME) | `@` | the apex target Vercel gives you |
| CNAME | `www` | Vercel's CNAME target |
| CNAME | `admin` | Vercel's CNAME target |

Add `voidix.tech` to the web project and `admin.voidix.tech` to the admin project. Certificates are
issued automatically once the records resolve.

### Supabase

Supabase is hosted separately from Vercel — one project serves both apps. Restrict the Auth
**Site URL** and redirect allow-list to `https://admin.voidix.tech` (plus `http://localhost:3001`
for local work), so an auth callback can't be redirected somewhere else.

### Publish flow, end to end

```
edit in admin.voidix.tech
   → write draft rows to Supabase
   → "Publish" flips status to published
   → POST https://voidix.tech/api/revalidate  (REVALIDATE_SECRET)
   → revalidateTag('content')
   → next request to voidix.tech renders the new copy
```

No redeploy, no rebuild, no CI run.

### Lead flow, end to end

```
visitor submits on voidix.tech
   → Server Action validates (zod) + verifies Turnstile
   → derives ip_hash / referrer / source_path server-side
   → insert into leads via the ANON key   (insert-only RLS, no read-back)
   → success state renders
   → Database Webhook → "a new lead arrived" + link (no message body)
   → staff open admin.voidix.tech and triage
```

The two flows never share a key. The site holds a key that can insert leads and read published
content, and nothing else.

### Checklist for the first deploy

1. `pnpm install && pnpm typecheck && pnpm build` locally, clean
2. Push the branch, open a PR — Vercel builds a preview for each project
3. Confirm the preview URLs render before attaching real domains
4. Attach domains, wait for DNS + certificates
5. Log into the panel, change one FAQ answer, publish, confirm it appears on the site
6. **Verify leads are unreadable publicly.** With only the anon key, confirm a `select` on `leads`
   returns nothing — then submit a real lead and confirm it appears in the panel. Do this before the
   form is linked anywhere

---

## 7. Decisions on record

| Decision | Chosen | Note |
|---|---|---|
| Data layer | Custom panel + Supabase | Over Payload and Sanity. Most work, full control, on-brand for a company that sells CRM systems |
| Panel scope | Everything, including shader tuning | The ambitious option; draft/publish + version history are the mitigations |
| Validation library | zod, in `packages/content` only | Explicit exception to the `CLAUDE.md` rule |
| Monorepo | Move now, one rename-only commit | Rather than relocating again at step 4 |
| Package manager | pnpm | The npm lockfile was deleted |
| 3D model uploads | **Not** in the panel | Models need `optimize:models` for Draco plus hand-tuned rotation and framing. A client-uploaded `.glb` would land sideways and at 40 MB. Models stay in the repo; images can go to object storage |
| Leads storage | Own table, own RLS, insert-only for anon | Flows the opposite direction to everything else. No `select` policy for anon, ever |
| Lead form fields | Four typed columns + `payload jsonb` | The form doesn't exist yet and will grow fields. jsonb means adding a question needs no migration, and old leads stay readable as asked |
| Lead types | A future `packages/leads`, **not** `@voidix/content` | A lead isn't content; folding it in would make that package's name a lie |
| Lead insert key | Anon key, server-side, not service-role | Least privilege. If abused the worst case is junk rows, not exfiltration |
| Content publishing | Whole-collection snapshots in `content_publications` | *Revised during step 2.* A per-row `status` lets a visitor catch a half-published collection |
| Tuning draft vs published | Separate tables, not two columns | *Revised during step 2.* RLS is row-level, so one row can't expose the published column while hiding the draft |
| Ordinals ("01") | Derived from place in the sorted collection | Storing them is how the item at position 0 ends up labelled "03" |
| Generated DB types | Hand-written in `rows.ts` for now | `supabase gen types` needs a live project; the package has to typecheck before one exists. Diff them once it does |

---

## 8. Known follow-ups

- **`CLAUDE.md` is stale and now actively misleading.** Every path in it is off by `apps/web/`, it
  still names the three content files as the source of truth, and it claims "no backend, no API
  routes, no database" — which step 3 makes false. It also predates `WorksField`, `Chamber`, and the
  labs.
- `next start` against a production build is unverified (see [2.8](#28-verification-performed)).
- The `?tune` panels need one visual confirmation pass in a browser.
- `apps/web/models-src` is where raw model sources now belong — the directory doesn't currently exist
  locally, so nothing needed moving, but put them there rather than at the repo root.
- **The contact form's field list is still open.** The `leads` columns above cover the four fields any
  contact form has; everything else goes in `payload`. Once the form's real questions are decided,
  promote anything you'll filter or sort by (project type, budget band) into a column and leave the
  rest in jsonb.
- **Lead notification is undecided** (see [Step 4b](#step-4b--contact-form-and-leads-inbox)). Pick
  something before the form ships — an unwatched inbox is worse than no form.
- **Lead retention has no policy yet.** Decide how long `spam` / `lost` rows are kept and schedule the
  delete, rather than accumulating personal data indefinitely.
