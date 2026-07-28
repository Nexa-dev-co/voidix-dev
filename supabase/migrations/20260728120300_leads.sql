-- Leads — the one table that flows the other way.
--
-- Everything else in this schema is written by the panel and read by the site. This is written by the
-- PUBLIC SITE and read only by the panel, and that inversion is the whole security story:
--
--   anon may INSERT. anon may not SELECT. There is deliberately no select policy below.
--
-- `NEXT_PUBLIC_SUPABASE_ANON_KEY` ships in the browser bundle and is public by design. If leads were
-- readable with it, the entire client list would be one request away. Without a select policy, nobody
-- holding that key can read a single lead — not even the row they just submitted.
--
-- The practical consequence: `.insert().select()` fails, because the select half has no policy.
-- Insert and return nothing; the thank-you state comes from the request succeeding.

create table leads (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),

  -- What the visitor typed. Columns rather than jsonb because these are the fields you sort, search,
  -- dedupe and email from.
  name         text   not null,
  email        citext not null,
  message      text   not null,
  company      text,

  -- Everything else the form asks — budget band, timeline, project type, how they found us. jsonb
  -- because the contact form will grow questions, and a lead is a record of what was asked AT THE
  -- TIME. Old rows stay readable after the form changes, with no migration and no backfill.
  payload      jsonb not null default '{}',

  -- Attribution and spam triage, all derived server-side. Never trust these from the client, and
  -- never store a raw IP: `ip_hash` is hashed with LEAD_IP_SALT so "forty submissions from one
  -- source" is still visible without holding personal data.
  source_path  text,
  referrer     text,
  ip_hash      text,
  user_agent   text,

  -- The sales pipeline. Nothing to do with content publishing — do not reuse that vocabulary here.
  status       text not null default 'new'
                 check (status in ('new','read','replied','qualified','won','lost','spam')),
  notes        text,
  handled_by   uuid references auth.users,
  handled_at   timestamptz
);

-- The inbox is "newest first, optionally filtered by status", so these two carry every panel query.
create index leads_created_at_idx on leads (created_at desc);
create index leads_status_idx     on leads (status);
create index leads_email_idx      on leads (email);

alter table leads enable row level security;

-- Submission. `with check (true)` accepts any row shape the client sends, which is why the insert
-- must go through a Server Action on voidix.tech that validates with zod first and derives
-- ip_hash / referrer / source_path itself.
create policy "anyone may submit a lead" on leads
  for insert to anon with check (true);

-- Reading and triage — staff only, behind the admin login.
create policy "staff manage leads" on leads
  for all to authenticated using (true) with check (true);

-- NOTE: there is no `for select to anon` policy here, and adding one would expose every lead.
-- If a future migration needs anon to read something about leads, add a view over aggregate counts
-- rather than opening this table.
