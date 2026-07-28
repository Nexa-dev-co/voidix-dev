import 'server-only';

import type { FaqEntryRow, ProjectRow, ServiceRow } from '@voidix/database';

import { createSupabaseServerClient } from './supabaseServer';

/**
 * Reads of the WORKING DRAFT tables — what the panel edits, and what the public can't see.
 *
 * These come back through the signed-in staff member's session, so RLS is doing the authorisation.
 * A signed-out request gets nothing rather than an error, which is why the middleware redirects
 * first: an empty page is a worse explanation than a login screen.
 */

export async function fetchServices(): Promise<ServiceRow[]> {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase.from('services').select('*').order('position');
  return (data ?? []) as ServiceRow[];
}

export async function fetchProjects(): Promise<ProjectRow[]> {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase.from('projects').select('*').order('position');
  return (data ?? []) as ProjectRow[];
}

export async function fetchFaqEntries(): Promise<FaqEntryRow[]> {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase.from('faq_entries').select('*').order('position');
  return (data ?? []) as FaqEntryRow[];
}

export interface PublicationSummary {
  version: number;
  label: string | null;
  publishedAt: string;
}

export async function fetchLatestPublication(): Promise<PublicationSummary | null> {
  const supabase = createSupabaseServerClient();
  const { data } = await supabase
    .from('content_publications')
    .select('version, label, published_at')
    .order('version', { ascending: false })
    .limit(1);

  const row = data?.[0];
  if (!row) return null;

  return { version: row.version, label: row.label, publishedAt: row.published_at };
}
