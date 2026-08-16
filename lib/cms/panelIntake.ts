/**
 * The site's side of the admin panel's two intake endpoints.
 *
 * ── ⚠ WHY THE FORMS DO NOT POST TO THE PANEL DIRECTLY ───────────────────────────────────────────
 * The panel authenticates with a shared secret in an `x-voidix-secret` header, and its own notes
 * are blunt about the consequence: a form that posts straight from the browser ships that secret to
 * every visitor, and the origin check, the rate limit and the honeypot become the only real
 * defences left. So the browser posts to this site's own routes, and only the server holds the key.
 *
 * It buys two more things worth having. The panel's URL never appears in the page, so the address
 * of the studio's leads database is not public knowledge. And the two systems can disagree about
 * details — a link typed without a scheme, a field this site calls `brief` and the panel calls
 * `message` — with the translation living in one place instead of in a form component.
 *
 * ⚠ SERVER ONLY. `VOIDIX_CMS_INTAKE_SECRET` has no `NEXT_PUBLIC_` prefix, so importing this from a
 * client component would compile and then fail closed at runtime, which is the confusing failure
 * rather than the loud one.
 */

/** Where the panel files an enquiry. Its inbox, not its pipeline — an admin decides what becomes a lead. */
export const SUBMISSIONS_PATH = '/api/submissions';

/** Where the panel files a job application. Emphatically not the leads pipeline. */
export const APPLICATIONS_PATH = '/api/applications';

/**
 * The panel's honeypot field, and the name is its whole trick — it looks worth filling in. The form
 * renders it hidden and empty; a bot that fills every input it finds fills this one too and the
 * panel answers it with a cheerful 202 that stores nothing.
 *
 * ⚠ Must stay spelled exactly as `HONEYPOT_FIELD` in the panel's `lib/leads/intake.ts`. A typo here
 * disables the trap silently — every submission simply passes a check that is no longer looking at
 * anything.
 */
export const HONEYPOT_FIELD = 'website';

/** A slow panel must not hold a visitor's submit button hostage; they will press it again. */
const REQUEST_TIMEOUT_MS = 10_000;

export type PanelIntakeResult =
  | { ok: true }
  /**
   * The panel rejected it and named fields. Passed back so the form can point at the input rather
   * than saying "that did not send" over a fixable mistake.
   */
  | { ok: false; reason: 'invalid'; fieldErrors: Record<string, string> }
  /** Too many submissions from this address in an hour. Worth its own message — it is temporary. */
  | { ok: false; reason: 'rate-limited' }
  /** Anything else: unconfigured, unreachable, a bad secret, a 500. Nothing the visitor can fix. */
  | { ok: false; reason: 'unavailable' };

/**
 * Posts one submission to the panel.
 *
 * ⚠ It never throws. A form handler's job at this point is to tell the visitor something true, and
 * an exception escaping into a route handler becomes a 500 and a generic browser error page in
 * place of the message the form was going to draw.
 */
export async function postToPanel(
  path: string,
  body: Record<string, string | undefined>,
): Promise<PanelIntakeResult> {
  const baseUrl = process.env.VOIDIX_CMS_URL;
  const secret = process.env.VOIDIX_CMS_INTAKE_SECRET;

  if (!baseUrl || !secret) {
    console.warn('[cms] intake is not configured — VOIDIX_CMS_URL or VOIDIX_CMS_INTAKE_SECRET is unset');
    return { ok: false, reason: 'unavailable' };
  }

  try {
    const response = await fetch(`${trimTrailingSlash(baseUrl)}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-voidix-secret': secret,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      // ⚠ Never cached. Next caches POSTs in some configurations and a cached submission is a
      // second person's enquiry silently answered with the first one's response.
      cache: 'no-store',
    });

    // ⚠ 202 is the honeypot's answer and it means NOTHING WAS STORED. It is reported as success on
    // purpose: a bot that learns which field betrayed it just stops filling that field in. A real
    // visitor cannot reach this branch without having filled a hidden input.
    if (response.ok) {
      return { ok: true };
    }

    if (response.status === 429) {
      return { ok: false, reason: 'rate-limited' };
    }

    if (response.status === 422) {
      const answer = (await response.json().catch(() => null)) as { fields?: unknown } | null;
      return {
        ok: false,
        reason: 'invalid',
        fieldErrors: readFieldErrors(answer?.fields),
      };
    }

    // 401 is the one worth spelling out: it means the two secrets have drifted apart, and from the
    // visitor's side that is indistinguishable from the studio ignoring them.
    console.warn(`[cms] intake rejected the submission: ${response.status} ${response.statusText}`);
    return { ok: false, reason: 'unavailable' };
  } catch (error) {
    console.warn(
      `[cms] could not reach the panel's intake: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    );
    return { ok: false, reason: 'unavailable' };
  }
}

/**
 * A link the way a person types it, as a URL the panel will accept.
 *
 * ⚠ THIS EXISTS BECAUSE THE TWO SIDES DISAGREE ON PURPOSE. The application form takes the work link
 * as `type="text"`, not `type="url"`, and says why: native URL validation demands a scheme, and
 * "behance.net/me" failing with a cryptic message costs more applications than an unvalidated
 * string ever will. The panel's schema, just as reasonably, refuses anything that is not
 * `http(s)://` — it is going to render that string as a link an admin clicks.
 *
 * Both are right, so the scheme is added here rather than either side giving way. Without it the
 * applicant who typed the sensible thing gets "that did not send" and no idea why.
 */
export function withUrlScheme(link: string): string {
  const trimmed = link.trim();
  if (trimmed.length === 0) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** An empty field and an absent one are the same fact, and the panel wants the absent form. */
export function orUndefined(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : undefined;
}

/** The panel returns `{ fields: { email: "…" } }`. Narrowed rather than trusted — it is over a network. */
function readFieldErrors(fields: unknown): Record<string, string> {
  if (!fields || typeof fields !== 'object') return {};

  const errors: Record<string, string> = {};
  for (const [field, message] of Object.entries(fields as Record<string, unknown>)) {
    if (typeof message === 'string') errors[field] = message;
  }
  return errors;
}

function trimTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}
