// Seeds a fresh Supabase project from the content compiled into @voidix/content.
//
//   pnpm --filter @voidix/database seed
//   pnpm --filter @voidix/database seed -- --force     (wipes the working tables first)
//
// Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, picking them up from a .env.local at the repo
// root if one exists.
//
// ── Why this is a script and not a seed.sql ──────────────────────────────────────────────────────
// The content already exists, fully authored, in packages/content/src/defaults. Re-typing it as SQL
// would create a second copy to keep in sync, and the first time someone edited one and not the other
// the database and the fallback would silently disagree. Importing the real defaults means there is
// exactly one source.
//
// ── What it does NOT seed ────────────────────────────────────────────────────────────────────────
// `leads` — starts empty in every environment, by design.
// `scene_tuning` — the tuning defaults still live in apps/web (deckTuning.ts, worksTuning.ts,
// chamberTuning.ts), and a package cannot import from an app. Those shapes move into a package as
// part of step 5, and this script grows a tuning pass then. Until then the site uses the values
// compiled into its own bundle, which is why an unseeded tuning table renders a correct site.

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_DECK_SERVICES,
  DEFAULT_FAQ_ENTRIES,
  DEFAULT_WORKS_PROJECTS,
  parseContentPayload,
} from '@voidix/content';

import { createAdminClient } from '../client';
import { toFaqEntryRow, toProjectRow, toServiceRow } from '../mappers';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

/** Node can read a .env file natively; older runtimes just skip this and rely on real env vars. */
function loadRepoEnvFile(): void {
  const envPath = resolve(REPO_ROOT, '.env.local');
  if (!existsSync(envPath)) return;

  const runtime = process as NodeJS.Process & { loadEnvFile?: (path: string) => void };
  if (typeof runtime.loadEnvFile !== 'function') return;

  runtime.loadEnvFile(envPath);
  console.log(`  env      loaded ${envPath}`);
}

async function seed(): Promise<void> {
  const force = process.argv.includes('--force');

  loadRepoEnvFile();
  const supabase = createAdminClient();

  // Guard: seeding twice would duplicate every row, and there's no natural key to conflict on.
  const { count, error: countError } = await supabase
    .from('services')
    .select('*', { count: 'exact', head: true });

  if (countError) throw new Error(`Could not read services: ${countError.message}`);

  if ((count ?? 0) > 0 && !force) {
    console.error(
      `\n  services already has ${count} row(s). Seeding again would duplicate them.\n` +
        '  Re-run with --force to wipe the working tables and reseed.\n',
    );
    process.exitCode = 1;
    return;
  }

  if (force) {
    // Order doesn't matter — nothing references these. The publication history is deliberately kept:
    // it's the record of what the site has actually served.
    for (const table of ['services', 'projects', 'faq_entries']) {
      const { error } = await supabase.from(table).delete().neq('position', -1);
      if (error) throw new Error(`Could not clear ${table}: ${error.message}`);
      console.log(`  cleared  ${table}`);
    }
  }

  // Array order is the display order, so the index is the position — written out rather than leaning
  // on `map` handing the callback its index.
  const serviceRows = DEFAULT_DECK_SERVICES.map((service, position) => toServiceRow(service, position));
  const projectRows = DEFAULT_WORKS_PROJECTS.map((project, position) => toProjectRow(project, position));
  const faqRows = DEFAULT_FAQ_ENTRIES.map((entry, position) => toFaqEntryRow(entry, position));

  // Three separate calls rather than a loop: each table's insert has its own row type, and a loop
  // collapses them into a union the client can't accept.
  await insertAll('services', serviceRows);
  await insertAll('projects', projectRows);
  await insertAll('faq_entries', faqRows);

  async function insertAll(table: string, rows: object[]): Promise<void> {
    const { error } = await supabase.from(table).insert(rows);
    if (error) throw new Error(`Could not seed ${table}: ${error.message}`);
    console.log(`  seeded   ${table} (${rows.length})`);
  }

  // Publish once, so the site has something to read the moment it points at this database. Validated
  // first: if the bundled defaults can't satisfy their own schema, that's a bug worth failing on here
  // rather than discovering when a page renders empty.
  const payload = parseContentPayload({
    services: DEFAULT_DECK_SERVICES,
    projects: DEFAULT_WORKS_PROJECTS,
    faqEntries: DEFAULT_FAQ_ENTRIES,
  });

  const { data: latest, error: latestError } = await supabase
    .from('content_publications')
    .select('version')
    .order('version', { ascending: false })
    .limit(1);

  if (latestError) throw new Error(`Could not read publications: ${latestError.message}`);

  const nextVersion = (latest?.[0]?.version ?? 0) + 1;

  const { error: publishError } = await supabase
    .from('content_publications')
    .insert({ payload, version: nextVersion, label: 'seeded from bundled defaults' });

  if (publishError) throw new Error(`Could not publish: ${publishError.message}`);
  console.log(`  published content version ${nextVersion}`);

  console.log('\n  done.\n');
}

seed().catch((error: unknown) => {
  console.error(`\n  seed failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
