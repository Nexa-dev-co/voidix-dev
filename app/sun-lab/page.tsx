import type { Metadata } from "next";
import SunLab from "@/components/lab/SunLab/SunLab";

/**
 * The fractured-sun lab — an authoring testbed for the new sun, not part of the site.
 *
 * `SunLab` is a Client Component doing all its WebGL work in an effect, so it's imported directly:
 * `ssr: false` isn't allowed in a Server Component, and this page stays one to export `metadata`.
 * Nothing here reaches the homepage bundle — it's a separate, noindexed route (like /letters).
 */

export const metadata: Metadata = {
  title: "voidix — fractured sun lab",
  description: "Authoring tool for the fractured sun: lighting, colour, stages.",
  robots: { index: false, follow: false },
};

export default function SunLabPage() {
  return (
    <main>
      <SunLab />
    </main>
  );
}
