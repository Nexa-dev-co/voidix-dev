import 'server-only';

import { parseContentPayload, type ContentPayload } from '@voidix/content';

/**
 * Reads the content the panel has published.
 *
 * ── Why a plain fetch and not supabase-js ────────────────────────────────────────────────────────
 * The whole read is one row from one view, and going through `fetch` means Next's cache handles it:
 * the page stays statically generated and is invalidated on demand by tag, instead of hitting the
 * database on every request. It also keeps the Supabase client library out of this app entirely.
 *
 * ── Why the anon key is the right key here ───────────────────────────────────────────────────────
 * `current_content` is the one thing the public is allowed to read (see supabase/migrations). The
 * anon key can't reach drafts or leads — that's enforced by RLS and proven by `pnpm verify`, not by
 * this file being careful. Note there's no NEXT_PUBLIC_ prefix on either variable: this module is
 * server-only, so nothing Supabase-related reaches the browser bundle.
 */

/** Cache tag the publish webhook invalidates. */
export const CONTENT_TAG = 'content';

/**
 * The published payload, or `null` to mean "use what's compiled into the bundle".
 *
 * Every failure path returns null rather than throwing: missing credentials (a fresh clone with no
 * .env.local), an unreachable database, an empty table, or a payload that doesn't satisfy the schema.
 * A content problem should degrade the site to its bundled defaults, never take the page down —
 * which is also why the defaults stay a complete, shippable set rather than a stub.
 */
export async function fetchPublishedContent(): Promise<ContentPayload | null> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) return null;

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/current_content?select=payload`, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
      next: { tags: [CONTENT_TAG] },
    });

    if (!response.ok) return null;

    const rows: unknown = await response.json();
    if (!Array.isArray(rows) || rows.length === 0) return null;

    const firstRow: unknown = rows[0];
    if (typeof firstRow !== 'object' || firstRow === null || !('payload' in firstRow)) return null;

    return parseContentPayload((firstRow as { payload: unknown }).payload);
  } catch {
    return null;
  }
}
