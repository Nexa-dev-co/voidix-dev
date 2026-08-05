/**
 * Whether the site's diagnostic console instruments run.
 *
 * ── Why this is not simply `NODE_ENV === 'development'` ──────────────────────────────────────────
 * That is what every instrument used to check, and it made them useless for the question they exist
 * to answer. A dev server tells you almost nothing about the thing being measured:
 *
 *   · `next.config.mjs` applies its immutable cache headers in PRODUCTION ONLY, so a dev log always
 *     understates caching — the one subject `cacheTelemetry` is about.
 *   · dev chunks are unminified and carry the HMR runtime, so bundle bytes are fiction.
 *   · routes are compiled on demand, so the first wave of requests parks behind webpack and every
 *     duration is inflated by seconds that will not exist in production.
 *   · StrictMode double-mounts every effect, so loads and builds are counted twice.
 *
 * A Vercel PREVIEW is a real production build with real headers on a real CDN, and it is not the
 * public site. That is the honest place to measure, so that is where these turn on.
 *
 * ⚠ Production stays silent. Visitors do not get a console full of instrumentation, and none of this
 * is a runtime knob — it is decided at build time, so a production bundle folds the checks below to
 * `false` and the bundler drops the logs entirely.
 */

/**
 * Vercel sets this on every deployment: `'production' | 'preview' | 'development'`.
 *
 * ⚠ Written out in full, deliberately. Next inlines `process.env.NEXT_PUBLIC_*` by matching the
 * literal text at build time — read it through a variable, a destructure or a computed key and you
 * get `undefined` in the browser. Same for the override below.
 *
 * It arrives automatically as long as the project's "Automatically expose System Environment
 * Variables" setting is on, which is the default.
 */
const VERCEL_ENVIRONMENT = process.env.NEXT_PUBLIC_VERCEL_ENV;

/**
 * The manual override, for the two cases the line above cannot cover: the system variables have been
 * switched off, or something needs measuring on the production deployment itself for once.
 *
 * Set `NEXT_PUBLIC_VOIDIX_TELEMETRY=1` in the Vercel dashboard, scoped to whichever environment, and
 * redeploy. Unset it when you are done — it is build-time, so it stays until the next deploy.
 */
const TELEMETRY_OVERRIDE = process.env.NEXT_PUBLIC_VOIDIX_TELEMETRY;

/** True where the console instruments should print. Constant for the life of the bundle. */
export const telemetryEnabled =
  process.env.NODE_ENV === 'development' ||
  VERCEL_ENVIRONMENT === 'preview' ||
  TELEMETRY_OVERRIDE === '1';
