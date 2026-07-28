-- Scene tuning — camera poses, light rigs, shader parameters.
--
-- ── Why this is a jsonb blob and not columns ─────────────────────────────────────────────────────
-- The shape of a scene's tuning changes every time a shader changes. `deckTuning.ts`, `worksTuning.ts`
-- and `chamberTuning.ts` gain and lose fields constantly during authoring, and normalising them into
-- columns would mean a migration per tweak. `sunLabStorage.ts` already solved this client-side with a
-- versioned document plus `normalizeState` to backfill fields added since a document was saved —
-- this is the same idea, server-side.
--
-- ── Draft and published are separate TABLES, not columns ─────────────────────────────────────────
-- The obvious design is one row holding `draft_data` and `published_data`, with the site reading the
-- published column through a view. That doesn't work: Postgres RLS is row-level, not column-level, so
-- any policy letting anon read the published column also lets it read the draft. Hiding the draft
-- behind a view only helps if the view bypasses RLS, which is exactly the footgun worth avoiding.
--
-- So drafts and published data live in different tables with different grants. Nothing the public can
-- reach ever contains work in progress.
--
-- The site applies published tuning with `restoreInPlace(DECK_TUNING, data)` before the scene boots —
-- never by reassigning the tuning object, because every scene holds it by reference (see
-- apps/web/lib/tunerReset.ts).

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- Draft — staff only
-- ─────────────────────────────────────────────────────────────────────────────────────────────────

create table scene_tuning (
  -- 'deck' | 'works' | 'chamber' | 'sun-lab' — matches the tuner panel that authors it.
  scene_key   text primary key,
  data        jsonb not null default '{}',
  version     integer not null default 1,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users
);

create trigger scene_tuning_set_updated_at
  before update on scene_tuning
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- Published — what voidix.tech reads
-- ─────────────────────────────────────────────────────────────────────────────────────────────────

-- A scene absent from this table has never been published, and the site keeps the values compiled
-- into its bundle. That's why a fresh database renders a correct site rather than a broken one.
create table scene_tuning_published (
  scene_key     text primary key,
  data          jsonb not null,
  version       integer not null,
  published_at  timestamptz not null default now(),
  published_by  uuid references auth.users
);

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- History — staff only
-- ─────────────────────────────────────────────────────────────────────────────────────────────────

-- Every publish appends here before overwriting the published row.
--
-- This table is the reason full shader tuning can be exposed in the panel at all. Someone will push
-- `emitStrength` to 40 at 1am and need the previous values back in one click; without history the
-- only recovery is remembering what the numbers used to be.
create table scene_tuning_versions (
  id          bigserial primary key,
  scene_key   text not null,
  data        jsonb not null,
  version     integer not null,
  label       text,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users
);

create unique index scene_tuning_versions_key_version_idx
  on scene_tuning_versions (scene_key, version desc);

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────────────────────────────

alter table scene_tuning           enable row level security;
alter table scene_tuning_published enable row level security;
alter table scene_tuning_versions  enable row level security;

create policy "staff manage tuning drafts" on scene_tuning
  for all to authenticated using (true) with check (true);

create policy "public reads published tuning" on scene_tuning_published
  for select to anon using (true);
create policy "staff manage published tuning" on scene_tuning_published
  for all to authenticated using (true) with check (true);

create policy "staff manage tuning history" on scene_tuning_versions
  for all to authenticated using (true) with check (true);
