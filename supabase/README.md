# Supabase — schema and how to apply it

The database behind voidix.tech and admin.voidix.tech. Full rationale lives in
[`../docs/admin-panel-plan.md`](../docs/admin-panel-plan.md); this file is the operational half.

## Migrations

| File | Contents |
|---|---|
| `20260728120000_helpers.sql` | `citext` extension, the `set_updated_at()` trigger function |
| `20260728120100_content.sql` | `services`, `projects`, `faq_entries` (drafts) + `content_publications` (published snapshots) + `current_content` view |
| `20260728120200_tuning.sql` | `scene_tuning` (draft), `scene_tuning_published`, `scene_tuning_versions` |
| `20260728120300_leads.sql` | `leads` |

They are ordered and must be applied in filename order. Each table's RLS policies live in the same
file as the table, so a table can never land without its access rules.

## One-time setup

There is **no local Supabase stack here** — that needs Docker, which isn't installed. These
instructions target a hosted project.

1. Create a project at [supabase.com](https://supabase.com). Pick the region closest to your users;
   it can't be changed later.
2. Copy the credentials from **Project Settings → API**:
   - Project URL
   - `anon` / public key — safe in a browser
   - `service_role` key — **server-side only**, bypasses every policy in these migrations
3. Create `.env.local` at the **repo root** (already gitignored):

   ```
   SUPABASE_URL=https://<project>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<service_role key>
   ```

   The seed script reads this file automatically.

## Applying the migrations

**Option A — the SQL editor.** Open each file in order and paste it into the project's SQL Editor.
Fine for the first run; you have to remember what you've already applied.

**Option B — the CLI.** More work up front, correct from then on. The CLI does *not* need Docker to
push to a hosted project:

```bash
npm install -g supabase
supabase login
supabase link --project-ref <your-project-ref>
supabase db push
```

Option B is worth doing before the schema starts changing.

## Seeding

```bash
pnpm seed              # from the repo root
pnpm seed -- --force   # wipe the working tables and reseed
```

This imports `DEFAULT_DECK_SERVICES`, `DEFAULT_WORKS_PROJECTS` and `DEFAULT_FAQ_ENTRIES` from
`@voidix/content` — the same data the site falls back to — so there is never a second copy to keep in
sync. It also writes **content publication version 1**, so the site has something to read immediately.

It refuses to run against a non-empty `services` table unless you pass `--force`, because nothing here
has a natural key to conflict on and a second run would silently duplicate every row.

**Not seeded:**

- `leads` — starts empty in every environment, deliberately.
- `scene_tuning` — the tuning defaults still live in `apps/web` (`deckTuning.ts`, `worksTuning.ts`,
  `chamberTuning.ts`) and a package can't import from an app. Those move into a package in step 5.
  Until then the site uses the tuning compiled into its own bundle, which is why an unseeded tuning
  table renders a correct site rather than a broken one.

## The access model, in one table

| Table | `anon` (the public site) | `authenticated` (staff) |
|---|---|---|
| `services`, `projects`, `faq_entries` | **nothing** | everything |
| `content_publications` | select | everything |
| `scene_tuning` (draft) | **nothing** | everything |
| `scene_tuning_published` | select | everything |
| `scene_tuning_versions` | **nothing** | everything |
| `leads` | **insert only** | everything |

Two rules that matter more than the rest:

1. **`leads` has no select policy for `anon`, and must never get one.** The anon key ships in the
   browser bundle and is public by design. A select policy there puts the entire client list one
   request away. As a consequence `.insert().select()` fails — insert and return nothing.
2. **Drafts are invisible to the public.** The working tables have no anon policy at all, so
   unpublished copy can't leak even by accident.

## Verifying it's right

```bash
pnpm verify              # from the repo root
```

Checks the data landed (row counts, the `current_content` view, and that the published payload
survives `parseContentPayload`), then re-connects **as the public** using the anon key and asserts the
access rules actually hold:

| Check | Expected |
|---|---|
| public reads `current_content` | allowed |
| public reads `services` (draft) | **empty** |
| public reads `scene_tuning` (draft) | **empty** |
| public reads `leads` | **empty** |
| public inserts a lead | allowed (the test row is deleted afterwards) |

The security half needs `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local` as well as the service-role
key — testing "the public cannot read leads" is only meaningful when done as the public. Without it
those checks are skipped rather than silently passing.

Re-run this after every migration. A policy that has quietly stopped applying looks exactly like a
policy that works.

> RLS returns an **empty set**, not an error, when no policy grants access. So "no rows" is the pass
> condition for the draft and leads checks — don't mistake a clean empty response for a failed query.

## Changing the schema later

Add a new timestamped file; never edit an applied one. Regenerate types afterwards and diff them
against `packages/database/src/rows.ts`, which is hand-written precisely so it can be checked:

```bash
supabase gen types typescript --linked > /tmp/generated.ts
```
