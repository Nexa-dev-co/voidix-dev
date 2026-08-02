import type { Metadata } from 'next';
import LabNav from '@/components/lab/LabNav';
import LetterLab from '@/components/lab/LetterLab/LetterLab';

/**
 * The letter lab — a testbed, not part of the site.
 *
 * `LetterLab` is a Client Component and all its WebGL work happens in an effect, so it's imported
 * directly rather than through `next/dynamic`: `ssr: false` isn't allowed in a Server Component, and
 * this page has to stay one to export `metadata`. Nothing here reaches the homepage bundle either way
 * — it's a separate route.
 */

export const metadata: Metadata = {
  title: 'voidix — letter lab',
  description: 'Extruded 3D glyph testbed.',
  robots: { index: false, follow: false },
};

export default function LettersPage() {
  return (
    <main>
      <LetterLab />
      {/* Fixed overlay rather than a header above the lab: `LetterLab` fills the viewport, and anything
          in the flow would push it off screen. */}
      <LabNav />
    </main>
  );
}
