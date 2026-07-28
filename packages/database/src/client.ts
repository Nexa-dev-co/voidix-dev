import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * A Supabase client authenticated with the **service-role key**, which bypasses RLS entirely.
 *
 * This is the key that can read every lead and rewrite every published row. It must only ever run
 * server-side — in the admin app's server code, in a Route Handler, or in a script like the seeder.
 * It must never be given to `apps/web`, and it must never be read from a variable prefixed
 * `NEXT_PUBLIC_`, because that prefix inlines the value into the browser bundle.
 *
 * For anything running in a browser, or for the public site, use the anon key instead: it can read
 * published content and insert a lead, and nothing else.
 */
export function createAdminClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error('SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) is not set.');
  }
  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set.');
  }
  assertNotThePublicKey(serviceRoleKey);

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Catch the easy mistake: pasting the public key into SUPABASE_SERVICE_ROLE_KEY.
 *
 * It fails in a genuinely confusing way — the client connects fine and reads work, then every write
 * is rejected by an RLS policy that looks correct, because the public key is subject to policies the
 * service-role key bypasses. Better to say so up front than to debug the policy.
 *
 * Both key formats are checked: legacy keys are JWTs carrying a `role` claim, newer ones are prefixed
 * `sb_secret_` / `sb_publishable_`.
 */
function assertNotThePublicKey(key: string): void {
  const wrongKey = (found: string): Error =>
    new Error(
      `SUPABASE_SERVICE_ROLE_KEY holds ${found}, not a service-role key. Copy the secret one from ` +
        'Supabase → Project Settings → API (it has to be revealed before you can copy it).',
    );

  if (key.startsWith('sb_publishable_')) throw wrongKey('a publishable key');

  if (key.startsWith('eyJ')) {
    const payload = key.split('.')[1];
    if (!payload) return;

    try {
      const claims: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      const role =
        typeof claims === 'object' && claims !== null && 'role' in claims
          ? (claims as { role: unknown }).role
          : undefined;

      if (typeof role === 'string' && role !== 'service_role') throw wrongKey(`the "${role}" key`);
    } catch (error) {
      // A malformed JWT is the caller's problem to discover on first request; only re-throw our own
      // diagnosis, not a JSON parse failure.
      if (error instanceof Error && error.message.startsWith('SUPABASE_SERVICE_ROLE_KEY')) throw error;
    }
  }
}
