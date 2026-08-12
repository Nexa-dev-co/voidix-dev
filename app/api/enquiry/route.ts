import { NextResponse } from 'next/server';
import {
  HONEYPOT_FIELD,
  orUndefined,
  postToPanel,
  SUBMISSIONS_PATH,
} from '@/lib/cms/panelIntake';

/**
 * The site's one contact form, on its way to the panel's inbox.
 *
 * Everything the fleet, the works field, the chamber, the about page and the contact section open
 * arrives here — there is one form on this site and therefore one endpoint behind it.
 *
 * ⚠ IT DOES NOT CREATE A LEAD, and that is the panel's design rather than a limitation. A
 * submission lands in an inbox and stops; an admin decides what becomes a contact. So a bot, a test
 * post and a "hi" never reach the pipeline, the counts or the reports.
 *
 * ── What this route is actually for ─────────────────────────────────────────────────────────────
 * Holding the secret. See `lib/cms/panelIntake.ts` — the browser must never see it. The translation
 * below is small enough to read in one go, and it is the whole of what the two systems disagree
 * about:
 *
 *   the form says      the panel stores
 *   ─────────────      ────────────────
 *   brief          →   message      (the same box, named for what each side does with it)
 *   subject        →   source       ("Web Development — like Aphelion" — where they came from)
 *   phone          →   phone        (nowhere to put this until the site was connected)
 *
 * ⚠ Only the email is required, here and in the form and now in the panel's schema too. That is a
 * decision the form documents at length: a required-field wall in front of a first message costs
 * more conversations than a tidier inbox is worth. If this route starts demanding a name, it is
 * overruling that from the outside.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let form: FormData;

  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Expected a form submission.' }, { status: 400 });
  }

  const read = (field: string) => orUndefined(String(form.get(field) ?? ''));

  const result = await postToPanel(SUBMISSIONS_PATH, {
    name: read('name'),
    email: read('email') ?? '',
    phone: read('phone'),
    message: read('brief'),
    source: read('subject'),
    // Forwarded rather than checked here. The panel owns the honeypot's meaning — it answers a
    // filled one with a success that stores nothing — and a second opinion on this side would only
    // create a way for the two to disagree about what counts as caught.
    [HONEYPOT_FIELD]: read(HONEYPOT_FIELD),
  });

  return NextResponse.json(result, { status: result.ok ? 201 : statusFor(result.reason) });
}

/**
 * ⚠ The visitor's side of a failure is three different situations, so it is three statuses. The
 * form draws a different sentence for each: try again in a minute, fix this field, or write to us
 * directly. One generic 500 for all three would make the fixable one unfixable.
 */
function statusFor(reason: 'invalid' | 'rate-limited' | 'unavailable'): number {
  if (reason === 'invalid') return 422;
  if (reason === 'rate-limited') return 429;
  return 502;
}

export function GET() {
  return NextResponse.json(
    { error: 'This endpoint accepts POST only.' },
    { status: 405, headers: { allow: 'POST' } },
  );
}
