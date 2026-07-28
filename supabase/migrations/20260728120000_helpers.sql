-- Extensions and shared helpers every later migration leans on.

-- Case-insensitive text, used for lead emails so "Rewaa@x.com" and "rewaa@x.com" are one person.
create extension if not exists citext;

-- Keeps `updated_at` honest without every writer having to remember it. Attached per-table below.
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Every table in this schema is deny-by-default: RLS is enabled and only the policies written
-- alongside each table grant anything. There is no blanket grant anywhere in these migrations, and
-- adding one would silently undo the leads protection in 20260728120300_leads.sql.
