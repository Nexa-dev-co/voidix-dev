import { NextResponse } from 'next/server';

/**
 * The journey batch, on its way to the panel.
 *
 * ── ⚠ WHAT THIS ROUTE IS FOR: HOLDING THE SECRET ───────────────────────────────────────────────
 * Exactly the reason `/api/enquiry` and `/api/application` exist, and `lib/cms/panelIntake.ts`
 * argues it at length: the panel authenticates with a shared secret, and a browser that posted
 * straight to it would ship that secret to every visitor. It also keeps the panel's address — the
 * location of the studio's own database — out of the page.
 *
 * ── ⚠ IT ANSWERS 204 WHATEVER HAPPENS, AND THAT IS NOT LAZINESS ────────────────────────────────
 * Nothing on the visitor's side can act on a failure here. There is no message to draw, no field to
 * fix and no retry worth making — a lost count is a lost count, and the one thing that must never
 * happen is an analytics endpoint surfacing an error into a page or holding a navigation open. So
 * this reports nothing and logs on the server, where somebody can actually see it.
 *
 * ⚠ It is also why there is no rate limit HERE. The panel owns that, as it does for the two forms,
 * and a second opinion on this side would only create a way for the two to disagree about what
 * counts as too much.
 *
 * ── ⚠ `sendBeacon` SENDS A BLOB, NOT JSON ──────────────────────────────────────────────────────
 * The final flush on `pagehide` arrives as `application/json` because the collector wraps it in a
 * Blob with that type — but a beacon cannot set headers, so nothing else can be relied on. The body
 * is read as text and parsed here rather than through `request.json()`, which would throw on a
 * content type this route cannot control.
 */
export const dynamic = 'force-dynamic';

/** The panel's own intake path. Mirrors SUBMISSIONS_PATH / APPLICATIONS_PATH in panelIntake.ts. */
const JOURNEY_PATH = '/api/journey';

/** A slow panel must never delay a page's unload. Shorter than the forms' 10 s for that reason. */
const REQUEST_TIMEOUT_MS = 4000;

export async function POST(request: Request) {
  const baseUrl = process.env.VOIDIX_CMS_URL;
  const secret = process.env.VOIDIX_CMS_INTAKE_SECRET;

  if (!baseUrl || !secret) {
    console.warn('[journey] intake is not configured — VOIDIX_CMS_URL or VOIDIX_CMS_INTAKE_SECRET is unset');
    return new NextResponse(null, { status: 204 });
  }

  let body: string;
  try {
    body = await request.text();
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  // A cheap shape check before spending a network call. The panel validates properly; this only
  // stops an obviously empty or malformed beacon becoming a request at all.
  if (body.length === 0 || body.length > 128_000) {
    return new NextResponse(null, { status: 204 });
  }

  try {
    const response = await fetch(`${trimTrailingSlash(baseUrl)}${JOURNEY_PATH}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-voidix-secret': secret,
        // ⚠ Forwarded so the PANEL can hash it with its own salt for rate limiting and bot filtering.
        // Its `.env` is explicit that raw IPs are never stored — see LEADS_IP_SALT — and this route
        // stores nothing at all, it only passes the value along to the system that already knows how
        // to handle one.
        'x-forwarded-for': request.headers.get('x-forwarded-for') ?? '',
        'user-agent': request.headers.get('user-agent') ?? '',
      },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: 'no-store',
    });

    if (!response.ok) {
      console.warn(`[journey] the panel rejected a batch: ${response.status} ${response.statusText}`);
    }
  } catch (error) {
    console.warn(
      `[journey] could not reach the panel: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }

  return new NextResponse(null, { status: 204 });
}

function trimTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

export function GET() {
  return NextResponse.json(
    { error: 'This endpoint accepts POST only.' },
    { status: 405, headers: { allow: 'POST' } },
  );
}
