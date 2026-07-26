import type { Metadata } from "next";
import SunLab from "@/components/lab/SunLab/SunLab";

/**
 * The sun lab — an authoring tool for fractured_sun.glb, not part of the site.
 *
 * Like the letter lab: `SunLab` is a Client Component whose WebGL work all happens in an effect, so it's
 * imported directly rather than through `next/dynamic` (`ssr: false` isn't allowed in a Server
 * Component, and this page stays one to export `metadata`). It's a separate route — nothing here reaches
 * the homepage bundle.
 */

export const metadata: Metadata = {
  title: "voidix — sun lab",
  description: "Fractured-sun authoring tool.",
  robots: { index: false, follow: false },
};

export default function SunLabPage() {
  return (
    <main>
      <SunLab />
    </main>
  );
}
