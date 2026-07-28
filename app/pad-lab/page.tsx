import type { Metadata } from 'next';
import PadLab from '@/components/lab/PadLab/PadLab';

/**
 * The landing-pad lab — an authoring tool for champion_astro_ring.glb, not part of the site.
 *
 * Like the sun and letter labs: `PadLab` is a Client Component whose WebGL work all happens in an
 * effect, so it's imported directly rather than through `next/dynamic` (`ssr: false` isn't allowed
 * in a Server Component, and this page stays one to export `metadata`). Separate route — nothing
 * here reaches the homepage bundle.
 */

export const metadata: Metadata = {
  title: 'voidix — pad lab',
  description: 'Landing-pad authoring tool.',
  robots: { index: false, follow: false },
};

export default function PadLabPage() {
  return (
    <main>
      <PadLab />
    </main>
  );
}
