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
    content/                # NEW — the shared content definition
      package.json
      tsconfig.json
      src/
        index.ts            # the public surface
        types.ts            # the contract
        validation.ts       # zod schemas for untrusted input
        runtime.ts          # the live arrays + hydrateContent()
        defaults/
          deckServices.ts
          worksProjects.ts
          faqEntries.ts
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
| 2 | Supabase project, schema, seed from `defaults/` | next |
| 3 | `packages/content` reads Supabase; site becomes DB-driven | |
| 4 | `apps/admin` — auth + CRUD for copy | |
| 5 | Tuning into the database, draft/publish, version history | |
| 6 | Live preview so tuning is judged by eye | |
| 7 | Two Vercel projects + DNS | |

Steps 1–4 already give a shippable panel. Steps 5–6 are the ambitious half and can land later
without blocking anything.

### Step 2 — Supabase schema

Content and tuning want opposite treatments.

**Content → real columns.** One row per item, explicit ordering.

```sql
create table services (
  id            uuid primary key default gen_random_uuid(),
  ordinal       text not null,          -- "01"
  name          text not null,
  eyebrow       text not null,
  description   text not null,
  capabilities  text[] not null default '{}',
  model_path    text not null,
  profile       jsonb not null,         -- ShipProfile
  light         jsonb,                  -- ShipLight
  model_rotation jsonb,
  position      int not null,
  status        text not null default 'draft',   -- draft | published
  updated_at    timestamptz not null default now()
);
-- projects, faq_entries follow the same pattern
```

`profile` and `light` stay `jsonb` even inside the content tables, because they're art direction with
a shape that moves whenever a shader changes.

**Tuning → one `jsonb` blob per scene.** Do *not* normalise shader parameters into columns.

```sql
create table scene_tuning (
  scene_key   text primary key,         -- 'deck' | 'works' | 'chamber' | 'sun-lab'
  data        jsonb not null,
  version     int not null default 1,
  status      text not null default 'draft',
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users
);

create table scene_tuning_versions (
  id          bigserial primary key,
  scene_key   text not null,
  data        jsonb not null,
  version     int not null,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users
);
```

The shape changes every time a shader is tuned, and `sunLabStorage.ts` already has `normalizeState`
to absorb exactly that drift — reuse that idea server-side rather than fighting it with migrations.

**RLS:** anon can `select` rows where `status = 'published'`. `authenticated` can do everything.

**Seeding:** write a script that imports `DEFAULT_DECK_SERVICES`, `DEFAULT_WORKS_PROJECTS`,
`DEFAULT_FAQ_ENTRIES` from `@voidix/content` and inserts them. Never hand-copy this data.

### Step 3 — the site reads the database

Content must render **server-side**. The intro loader and WebGL boot are already competing for the
first seconds; a client-side content round-trip would land squarely on top of them.

```
Server Component  →  fetch published rows
                  →  parseContentPayload(rows)     ← zod, server-side only
                  →  hydrateContent(payload)       ← before the scenes boot
                  →  render
```

On a parse failure, catch and fall back to the bundled defaults rather than render a half-empty page.

Cache with `revalidateTag('content')`. The site gains its first API route, `POST /api/revalidate`,
which the panel calls on publish. **This makes the "no backend, no API routes" line in `CLAUDE.md`
false** — that file needs updating regardless, since every path in it is now off by `apps/web/`.

### Step 4 — the admin app

`apps/admin`, a Next.js app with Supabase Auth. CRUD for services, projects and FAQ entries, with the
same zod schemas driving form validation — so the panel literally cannot submit a shape the site
can't render.

Separate domain means separate cookie scope, which is a feature: an admin session never touches the
public site.

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
| `pnpm dev` | site dev server on **http://localhost:3000** |
| `pnpm build` | production build of the site |
| `pnpm start` | serve the production build (stop `pnpm dev` first — they share `.next`) |
| `pnpm lint` | lint the site |
| `pnpm typecheck` | typecheck **every** workspace member |
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
REVALIDATE_SECRET=…            # shared with the admin, guards /api/revalidate
```

`apps/admin/.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=…
NEXT_PUBLIC_SUPABASE_ANON_KEY=…
SUPABASE_SERVICE_ROLE_KEY=…    # server-side only — never NEXT_PUBLIC_
REVALIDATE_SECRET=…
SITE_URL=http://localhost:3000 # where to send revalidate + preview
```

The service-role key bypasses RLS. It belongs only in the admin, only server-side, and never in a
variable prefixed `NEXT_PUBLIC_`.

---

## 5. Working in this repo now

- **Editing content in code** → `packages/content/src/defaults/`. Still the fallback and the seed.
- **Editing the content contract** → `types.ts` *and* `validation.ts`. The `satisfies` annotation
  makes the compiler force you to do both.
- **Editing a scene** → unchanged, `apps/web/components/sections/**`.
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

### Checklist for the first deploy

1. `pnpm install && pnpm typecheck && pnpm build` locally, clean
2. Push the branch, open a PR — Vercel builds a preview for each project
3. Confirm the preview URLs render before attaching real domains
4. Attach domains, wait for DNS + certificates
5. Log into the panel, change one FAQ answer, publish, confirm it appears on the site

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
