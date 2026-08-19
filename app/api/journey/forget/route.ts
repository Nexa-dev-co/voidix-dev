import { NextResponse } from 'next/server';

/**
 * A visitor withdrawing consent, forwarded to the panel.
 *
 * ⚠ Exists for the same reason `/api/journey` does — the panel's secret must never reach a browser.
 * See `lib/cms/panelIntake.ts`.
 *
 * ⚠ It answers 204 whatever happens, and unlike the intake that is NOT purely a convenience: the
 * browser has already deleted its own copy of the identifier by the time this resolves, so there is
 * nothing the visitor could usefully do with a failure and nothing they could retry. What must not
 * happen is a page showing an error about a privacy action that has, locally, already succeeded.
 * The panel logs a failure loudly at its end, which is where somebody can act on it.
 */
export const dynamic = 'force-dynamic';

const FORGET_PATH = '/api/journey/forget';
const REQUEST_TIMEOUT_MS = 6000;

export async function POST(request: Request) {
  const baseUrl = process.env.VOIDIX_CMS_URL;
  const secret = process.env.VOIDIX_CMS_INTAKE_SECRET;

  if (!baseUrl || !secret) {
    console.warn('[journey] withdrawal cannot be forwarded — the panel is not configured');
    return new NextResponse(null, { status: 204 });
  }

  let body: string;
  try {
    body = await request.text();
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  try {
    await fetch(`${trimTrailingSlash(baseUrl)}${FORGET_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-voidix-secret': secret },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: 'no-store',
    });
  } catch (error) {
    console.warn(
      `[journey] could not forward a withdrawal: ${error instanceof Error ? error.message : 'unknown error'}`,
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
