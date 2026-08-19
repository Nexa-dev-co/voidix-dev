/**
 * One UUID generator for the journey layer.
 *
 * ⚠ Shared because two callers need identical output and one of them is a privacy boundary. The
 * session id and the visitor id both land in `@db.Uuid` columns, so a generator that drifted between
 * them would fail at the database rather than in the browser — and it would fail for one tier only,
 * which is the hardest kind of bug to notice.
 *
 * ⚠ NOT `Math.random()`. The visitor id is the one value on this site that must not be derivable from
 * another visitor's; a predictable generator would let one be guessed from another, which is a
 * cross-visitor linkage — precisely the thing consent was obtained to avoid.
 */

/**
 * `crypto.randomUUID` is unavailable on insecure origins and in a few older Safaris, and losing a
 * whole tier over it is not worth it. The fallback is `getRandomValues`, far more widely available,
 * formatted to the same shape so a Postgres `uuid` column accepts either.
 */
export function createUuid(): string | undefined {
  if (typeof crypto === 'undefined') return undefined;

  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();

  if (typeof crypto.getRandomValues !== 'function') return undefined;

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  // Version 4, variant 10xx — the two fields a v4 UUID is required to pin.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}
