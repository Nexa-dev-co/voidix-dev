/**
 * Is `VOIDIX_CMS_URL` pointing back at THIS server?
 *
 * ── ⚠ WHY THIS CHECK HAS TO EXIST ──────────────────────────────────────────────────────────────
 * `/api/journey` and `/api/journey/forget` forward to a path on the panel that is spelled EXACTLY
 * the same as their own — the panel's journey intake is `/api/journey` too. So the moment
 * `VOIDIX_CMS_URL` resolves to this site's own origin, the route posts to itself, that copy posts
 * to itself, and the recursion only stops when each level's `AbortSignal.timeout` fires four
 * seconds later. One analytics batch from one browser becomes a fan-out of hung requests.
 *
 * That is not a hypothetical misconfiguration. Both apps are `next dev`, both default to port 3000,
 * and whichever starts first takes it — so with the panel switched off, the SITE binds 3000 and
 * becomes the thing its own `VOIDIX_CMS_URL` names. The symptom is a wall of
 * `[journey] could not reach the panel: The operation was aborted due to timeout`, and the timeout
 * is the tell: nothing listening would refuse the connection in a millisecond.
 *
 * ⚠ The forms don't need it — `/api/enquiry` forwards to `/api/submissions`, a path this app does
 * not own, so a self-addressed panel URL 404s there instead of looping. That is luck, not design,
 * which is why this lives in `lib/cms/` rather than inside the journey route.
 */

/**
 * ⚠ Once per server process, not once per request. The whole point is to stop an endpoint anyone
 * can reach from writing a line to the log every time they reach it.
 */
let hasWarned = false;

export function isPanelAddressedToSelf(baseUrl: string, request: Request): boolean {
  // Whatever this server is being called as. Behind a proxy it is the public host, and the panel's
  // real domain will not match it — which is the correct answer.
  const ownHost = request.headers.get('host');
  if (!ownHost) return false;

  let panelHost: string;
  try {
    panelHost = new URL(baseUrl).host;
  } catch {
    // An unparseable URL is a different fault, and the caller's own fetch will report it honestly.
    return false;
  }

  if (panelHost !== ownHost) return false;

  if (!hasWarned) {
    hasWarned = true;
    console.warn(
      `[cms] VOIDIX_CMS_URL points at this server (${ownHost}) — the panel is not running here. ` +
        'Forwarding is switched off for this process; start the panel, or give it a port of its own.',
    );
  }
  return true;
}
