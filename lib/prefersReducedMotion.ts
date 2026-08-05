import { isReducedMotion } from '@/lib/motionPreference';

/**
 * True when motion should be suppressed — because the OS asked, or because the visitor did.
 *
 * ⚠ This is no longer a direct `matchMedia` read. It resolves through `lib/motionPreference.ts`, so
 * an in-page override wins over the OS setting and the answer can change during a session. Every
 * existing call site keeps working unchanged; a call site that wants to RESPOND to a mid-session
 * change has to stop capturing the result into a `const` and either ask per frame or subscribe.
 */
export function prefersReducedMotion(): boolean {
  return isReducedMotion();
}
