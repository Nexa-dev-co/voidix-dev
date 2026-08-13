import { NextResponse } from 'next/server';
import { telemetryEnabled } from '@/lib/telemetryEnabled';

/**
 * The browser's console capture, re-logged on the SERVER so it lands in Vercel's runtime logs.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────────────────────────
 * Vercel only ever sees server output. Every instrument on this site — `[voidix] device tier`,
 * `[voidix] gpu probe`, `[pixels] ALLOCATED`, the frame profiler's gauges — runs in the browser, so a
 * phone's numbers stay on the phone. That is fine on Android, where `chrome://inspect` gives you a
 * real remote console from any desktop OS. **It is not fine on iOS**, where Web Inspector requires
 * macOS and there is no supported path from Windows at all.
 *
 * So the capture is POSTed here and printed. `vercel logs` then has the phone's session in it, in
 * plain text, copy-pasteable — which is better than a remote console for the actual job anyway: the
 * numbers end up somewhere you can share rather than somewhere you have to transcribe.
 *
 * ⚠ IT IS A DIAGNOSTIC, NOT A PRODUCT FEATURE. `telemetryEnabled` is a build-time constant, false in
 * production, and this route answers 404 there — it must not exist as a public endpoint, because an
 * open "log whatever I send you" route is an invitation to fill someone's log budget.
 *
 * ⚠ It takes no secret and does no work. There is nothing to authenticate because there is nothing
 * behind it; the 404 above is the whole of the protection, and it is sufficient precisely because the
 * route is absent from the only build that is reachable by the public.
 *
 * See `docs/sun-mobile-quality-plan.md` §7–8 for what to read out of it.
 */

export const dynamic = 'force-dynamic';

interface BeaconPayload {
  /** Which send this was — `burn-in`, `pagehide`, `manual`. Lets two captures be told apart. */
  tag?: unknown;
  /** 1-based, so the log reads `2/6` rather than `1/6` twice. */
  index?: unknown;
  total?: unknown;
  body?: unknown;
}

export async function POST(request: Request) {
  // Not `403`: a route that refuses is a route that exists. In production this should be
  // indistinguishable from a path that was never deployed.
  if (!telemetryEnabled) return new NextResponse(null, { status: 404 });

  let payload: BeaconPayload;
  try {
    payload = (await request.json()) as BeaconPayload;
  } catch {
    return NextResponse.json({ error: 'Expected JSON.' }, { status: 400 });
  }

  const tag = typeof payload.tag === 'string' ? payload.tag : 'unknown';
  const index = typeof payload.index === 'number' ? payload.index : 0;
  const total = typeof payload.total === 'number' ? payload.total : 0;
  const body = typeof payload.body === 'string' ? payload.body : '';

  // One chunk per line, prefixed so the whole session greps out of a busy log as a unit and the
  // chunks can be reassembled in order by eye.
  console.log(`[beacon ${tag} ${index}/${total}]\n${body}`);

  return NextResponse.json({ ok: true });
}
