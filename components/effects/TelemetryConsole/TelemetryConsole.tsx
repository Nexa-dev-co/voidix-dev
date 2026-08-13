'use client';

/**
 * Renders nothing. Exists so `lib/telemetryLog` is imported early enough to catch the first line.
 *
 * The capture installs as a module side effect, so what actually matters here is WHERE this sits in
 * the import graph — mounted from the root layout, it lands in the initial client bundle and runs
 * before any scene has had a chance to log. An effect would be too late; `[voidix] device tier` and
 * the opening `[cache]` lines are out before the first commit's effects run.
 *
 * ⚠ It is inert in production. `telemetryEnabled` is decided at build time, so the module's install
 * function returns immediately and the bundler drops the body.
 */
import '@/lib/telemetryLog';
// ⚠ AFTER the capture, never before. The beacon installs `voidix.send` onto the API the line above
// creates, so importing it first would find no `window.voidix` to extend.
import './telemetryBeacon';

export default function TelemetryConsole() {
  return null;
}
