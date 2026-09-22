'use client';

import { usePathname } from 'next/navigation';
import { NOT_FOUND_COORDINATES_LABEL, NOT_FOUND_COORDINATES_VERDICT } from './notFoundContent';

/**
 * The readout that names the address the visitor actually asked for.
 *
 * ⚠ The page's only client island, and the only reason it needs one: `not-found.tsx` receives no
 * params and Next hands a Server Component no reliable way to read the requested path. Echoing it back
 * is what turns "page not found" into "this specific thing is not here", which is the difference
 * between a dead end and a diagnosis.
 *
 * React escapes it as text, so a hostile path renders as characters and nothing else.
 */
export default function LostCoordinates() {
  const pathname = usePathname();

  return (
    <p className="lost-coordinates">
      <span className="lost-coordinates-label">{NOT_FOUND_COORDINATES_LABEL}</span>
      <span className="lost-coordinates-path">{pathname}</span>
      <span className="lost-coordinates-verdict">— {NOT_FOUND_COORDINATES_VERDICT}</span>
    </p>
  );
}
