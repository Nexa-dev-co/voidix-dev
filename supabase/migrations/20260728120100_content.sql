-- Editable content: the services fleet, the works projects, the FAQ.
--
-- ── Two layers, and why ──────────────────────────────────────────────────────────────────────────
-- The three tables below are the WORKING DRAFT. The panel edits them freely and the public can't see
-- them at all.
--
-- `content_publications` is what the site actually reads: one row per publish, holding a complete
-- `ContentPayload` snapshot of all three collections at once.
--
-- The unit of publishing is the COLLECTION, not the row. The site loads every service in one go, so
-- a per-row published flag would let a visitor catch a half-edited fleet — three services updated,
-- the fourth still showing last week's copy. A snapshot makes publish atomic, gives version history
-- and rollback for free (re-publish an older row), and means the site validates one blob with
-- `parseContentPayload` rather than reassembling collections from loose rows.
--
-- ── Ordinals are derived, not stored ─────────────────────────────────────────────────────────────
-- `DeckService.index` ("01"), `WorksProject.index`, `FaqEntry.index` are display strings derived from
-- `position` when a row is mapped back to its domain type. Storing them separately guarantees that
-- one day something sits at position 0 labelled "03".

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- Working draft tables
-- ─────────────────────────────────────────────────────────────────────────────────────────────────

create table services (
  id             uuid primary key default gen_random_uuid(),
  position       integer not null,
  name           text not null,
  eyebrow        text not null,
  description    text not null,
  capabilities   text[] not null default '{}',
  -- A Draco-compressed vessel under apps/web/public/models. Models are NOT uploadable through the
  -- panel: they need `optimize:models` plus hand-tuned rotation and framing, so this is a pick from
  -- what's already in the repo.
  model_path     text not null,
  -- ShipProfile — a graded palette or the legacy two-tone tint. jsonb because it is art direction
  -- whose shape moves whenever hullMaterial.ts changes.
  profile        jsonb not null,
  light          jsonb,
  model_rotation jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table projects (
  id           uuid primary key default gen_random_uuid(),
  position     integer not null,
  title        text not null,
  client       text not null,
  year         text not null,
  description  text not null,
  tags         text[] not null default '{}',
  -- ProjectRock: seed, sizeScale, color, textureRepeat. Null means "use the global worksTuning
  -- values" — the same meaning omitting `rock` has in code.
  rock         jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table faq_entries (
  id          uuid primary key default gen_random_uuid(),
  position    integer not null,
  question    text not null,
  -- One entry per paragraph. The hologram measures its own content, so length is free.
  answer      text[] not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index services_position_idx    on services    (position);
create index projects_position_idx    on projects    (position);
create index faq_entries_position_idx on faq_entries (position);

create trigger services_set_updated_at
  before update on services
  for each row execute function set_updated_at();

create trigger projects_set_updated_at
  before update on projects
  for each row execute function set_updated_at();

create trigger faq_entries_set_updated_at
  before update on faq_entries
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- Published snapshots — what voidix.tech reads
-- ─────────────────────────────────────────────────────────────────────────────────────────────────

create table content_publications (
  id            bigserial primary key,
  -- A complete ContentPayload: { services, projects, faqEntries }. Validated with
  -- `parseContentPayload` on the way out, so a bad row degrades to the bundled defaults rather than
  -- rendering a half-empty page.
  payload       jsonb not null,
  version       integer not null,
  -- Free-text label for the version picker ("pre-launch copy", "reverted Cinder blurb").
  label         text,
  published_at  timestamptz not null default now(),
  published_by  uuid references auth.users
);

create unique index content_publications_version_idx on content_publications (version desc);

-- The site's read is a single row. `security_invoker` matters: without it a view runs as its owner
-- and quietly bypasses the caller's RLS — here that would be harmless, since publications are public
-- anyway, but it's the wrong habit to build in a file that also governs drafts.
create view current_content
with (security_invoker = true)
as
  select payload, version, label, published_at
  from content_publications
  order by version desc
  limit 1;

-- Views don't pick up the default privileges Supabase grants on new tables, so this has to be
-- explicit or the site gets a permission error rather than content. The RLS policy on the underlying
-- table is still what actually decides — this only opens the door.
grant select on current_content to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────────────────────────────

alter table services             enable row level security;
alter table projects             enable row level security;
alter table faq_entries          enable row level security;
alter table content_publications enable row level security;

-- Drafts are staff-only. There is deliberately no anon policy on the three working tables: the
-- public reads published snapshots and nothing else, so unpublished copy can never leak.
create policy "staff manage services"    on services
  for all to authenticated using (true) with check (true);
create policy "staff manage projects"    on projects
  for all to authenticated using (true) with check (true);
create policy "staff manage faq entries" on faq_entries
  for all to authenticated using (true) with check (true);

-- Published snapshots are the one thing the world may read.
create policy "public reads publications" on content_publications
  for select to anon using (true);
create policy "staff manage publications" on content_publications
  for all to authenticated using (true) with check (true);
