// Checks a Supabase project matches what supabase/migrations intends — both that the data is there
// and, more importantly, that the access rules actually hold.
//
//   pnpm verify
//
// The security half needs NEXT_PUBLIC_SUPABASE_ANON_KEY as well as the service-role key, because the
// only honest way to test "the public cannot read leads" is to try it as the public.
//
// Worth re-running after every migration. A policy that silently stopped applying looks exactly like
// a policy that works, right up until it doesn't.

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';
import { parseContentPayload } from '@voidix/content';

import { createAdminClient } from '../client';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

function loadRepoEnvFile(): void {
  const envPath = resolve(REPO_ROOT, '.env.local');
  if (!existsSync(envPath)) return;
  const runtime = process as NodeJS.Process & { loadEnvFile?: (path: string) => void };
  runtime.loadEnvFile?.(envPath);
}

let failures = 0;

function report(passed: boolean, label: string, detail = ''): void {
  console.log(`  ${passed ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  if (!passed) failures += 1;
}

async function verify(): Promise<void> {
  loadRepoEnvFile();
  const admin = createAdminClient();

  console.log('\n  content\n');

  for (const [table, expected] of [
    ['services', 4],
    ['projects', 4],
    ['faq_entries', 7],
  ] as const) {
    const { count, error } = await admin.from(table).select('*', { count: 'exact' });
    const passed = !error && count === expected;
    report(passed, `${table} has ${expected} rows`, passed ? '' : (error?.message ?? `got ${count}`));
  }

  const { data: publications, error: publicationError } = await admin
    .from('current_content')
    .select('payload, version');

  const publication = publications?.[0];
  report(!publicationError && Boolean(publication), 'current_content view returns a row', publicationError?.message);

  if (publication) {
    try {
      const payload = parseContentPayload(publication.payload);
      report(
        payload.services?.length === 4 && payload.projects?.length === 4 && payload.faqEntries?.length === 7,
        'published payload validates and is complete',
        `v${publication.version}`,
      );
    } catch (error) {
      report(false, 'published payload validates', error instanceof Error ? error.message : String(error));
    }
  }

  // ── The security half ──────────────────────────────────────────────────────────────────────────

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    console.log('\n  access rules\n');
    console.log('  skipped — set NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local to run these.\n');
    return;
  }

  console.log('\n  access rules (as the public)\n');
  const publicClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const publicContent = await publicClient.from('current_content').select('version');
  report(!publicContent.error && (publicContent.data?.length ?? 0) > 0, 'public CAN read published content');

  // Drafts are staff-only. RLS returns an empty set rather than an error when no policy grants access,
  // so "no rows" is the pass condition here, not an error.
  const publicDrafts = await publicClient.from('services').select('id');
  report((publicDrafts.data?.length ?? 0) === 0, 'public CANNOT read draft services',
    publicDrafts.data?.length ? `LEAKED ${publicDrafts.data.length} rows` : '');

  const publicTuningDraft = await publicClient.from('scene_tuning').select('scene_key');
  report((publicTuningDraft.data?.length ?? 0) === 0, 'public CANNOT read draft tuning',
    publicTuningDraft.data?.length ? `LEAKED ${publicTuningDraft.data.length} rows` : '');

  // The one that matters most.
  const publicLeads = await publicClient.from('leads').select('id, email');
  report((publicLeads.data?.length ?? 0) === 0, 'public CANNOT read leads',
    publicLeads.data?.length ? `LEAKED ${publicLeads.data.length} rows` : '');

  // ...but must still be able to submit one, or the contact form can't work.
  const submission = await publicClient.from('leads').insert({
    name: 'verify script',
    email: 'verify@example.invalid',
    message: 'Automated check that the public can submit. Safe to delete.',
    payload: { automated: true },
  });
  report(!submission.error, 'public CAN submit a lead', submission.error?.message);

  if (!submission.error) {
    const { error: cleanupError } = await admin
      .from('leads')
      .delete()
      .eq('email', 'verify@example.invalid');
    report(!cleanupError, 'test lead cleaned up', cleanupError?.message);
  }
}

verify()
  .then(() => {
    console.log(failures === 0 ? '\n  all checks passed.\n' : `\n  ${failures} check(s) FAILED.\n`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch((error: unknown) => {
    console.error(`\n  verify failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
