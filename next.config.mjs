/**
 * ⚠ `headers()` is PRODUCTION ONLY, and that is the point of the guard rather than an oversight.
 *
 * A year-long immutable cache is exactly what these files want in production — they are large, they
 * change rarely, and every reload currently pays a conditional request for each one. It is exactly
 * what you do NOT want in development, where `npm run optimize:models` rewrites a model in place and
 * the browser would then serve the old bytes until the filename changed or the cache was cleared by
 * hand. That is a genuinely confusing afternoon, so dev keeps Next's default.
 *
 * ⚠ In production the trade is real and worth knowing: re-exporting a model under the SAME name will
 * not reach anyone who has already loaded the site. Give it a new filename when the contents change.
 */
const IMMUTABLE_ASSET_CACHE = 'public, max-age=31536000, immutable';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    if (process.env.NODE_ENV !== 'production') return [];
    return [
      // The models and their surfaces — ~10 MB across the site, and the reason a reload feels like a
      // first visit. Next serves `public/` as `max-age=0` by default, so every one of these is a
      // round trip on every load even when the body is already on disk.
      { source: '/models/:path*', headers: [{ key: 'Cache-Control', value: IMMUTABLE_ASSET_CACHE }] },
      { source: '/textures/:path*', headers: [{ key: 'Cache-Control', value: IMMUTABLE_ASSET_CACHE }] },
      // The Draco decoder is a versioned third-party build that never changes in place, so this one
      // carries none of the caveat above.
      { source: '/draco/:path*', headers: [{ key: 'Cache-Control', value: IMMUTABLE_ASSET_CACHE }] },
    ];
  },
};

export default nextConfig;
