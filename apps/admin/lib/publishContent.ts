import 'server-only';

import { parseContentPayload } from '@voidix/content';
import { toContentPayload, type FaqEntryRow, type ProjectRow, type ServiceRow } from '@voidix/database';

import { createSupabaseServerClient } from './supabaseServer';

/**
 * Turns the current draft into a published snapshot the site will serve.
 *
 * ── The order here is the safety ─────────────────────────────────────────────────────────────────
 * Validate BEFORE inserting. `parseContentPayload` is the same function the site runs on the way in,
 * and it enforces MAX_WORKS_PROJECTS along with every colour, range and required field. Publishing an
 * invalid payload and letting the site reject it would revert the whole site to its bundled defaults
 * over one bad row — so a bad draft fails here, loudly, and the live site never moves.
 *
 * Revalidation is deliberately NOT part of the transaction. If the webhook fails, the publish still
 * happened and the site catches up on its next natural revalidation; reporting it as a failure would
 * tempt someone into publishing again and stacking duplicate versions.
 */

export interface PublishResult {
  ok: boolean;
  version?: number;
  error?: string;
  /** Publish succeeded but the site wasn't told to refresh — it'll catch up on its own. */
  revalidateWarning?: string;
}

export async function publishContent(label: string | null): Promise<PublishResult> {
  const supabase = createSupabaseServerClient();

  const [services, projects, faqEntries] = await Promise.all([
    supabase.from('services').select('*').order('position'),
    supabase.from('projects').select('*').order('position'),
    supabase.from('faq_entries').select('*').order('position'),
  ]);

  const failed = services.error ?? projects.error ?? faqEntries.error;
  if (failed) return { ok: false, error: `Could not read the draft: ${failed.message}` };

  let payload;
  try {
    payload = parseContentPayload(
      toContentPayload({
        services: (services.data ?? []) as ServiceRow[],
        projects: (projects.data ?? []) as ProjectRow[],
        faqEntries: (faqEntries.data ?? []) as FaqEntryRow[],
      }),
    );
  } catch (error) {
    return { ok: false, error: describeValidationFailure(error) };
  }

  const { data: latest } = await supabase
    .from('content_publications')
    .select('version')
    .order('version', { ascending: false })
    .limit(1);

  const nextVersion = (latest?.[0]?.version ?? 0) + 1;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error: insertError } = await supabase.from('content_publications').insert({
    payload,
    version: nextVersion,
    label: label?.trim() || null,
    published_by: user?.id ?? null,
  });

  if (insertError) return { ok: false, error: `Could not publish: ${insertError.message}` };

  const revalidateWarning = await revalidateSite();

  return { ok: true, version: nextVersion, revalidateWarning };
}

/**
 * Tell voidix.tech to drop its cached content.
 *
 * Returns a warning string rather than throwing — see the note above about why a failed webhook is
 * not a failed publish.
 */
async function revalidateSite(): Promise<string | undefined> {
  const siteUrl = process.env.SITE_URL;
  const secret = process.env.REVALIDATE_SECRET;

  if (!siteUrl || !secret) {
    return 'SITE_URL or REVALIDATE_SECRET is not set, so the site was not told to refresh.';
  }

  try {
    const response = await fetch(`${siteUrl}/api/revalidate`, {
      method: 'POST',
      headers: { 'x-revalidate-secret': secret },
      cache: 'no-store',
    });

    if (!response.ok) {
      return `The site returned ${response.status} when asked to refresh. It will catch up on its own.`;
    }
  } catch {
    return 'The site could not be reached to refresh. It will catch up on its own.';
  }

  return undefined;
}

/**
 * zod's default message is a JSON blob of issues. Staff need the one sentence that says what to fix.
 */
function describeValidationFailure(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'issues' in error) {
    const issues = (error as { issues: { path: (string | number)[]; message: string }[] }).issues;
    const first = issues[0];
    if (first) {
      const where = first.path.length > 0 ? `${first.path.join(' → ')}: ` : '';
      const more = issues.length > 1 ? ` (and ${issues.length - 1} more)` : '';
      return `${where}${first.message}${more}`;
    }
  }
  return error instanceof Error ? error.message : 'The draft did not validate.';
}
