/**
 * Structured data — what the site tells a search engine about itself in a form it can parse.
 *
 * ── ⚠ WHY THE FAQ SCHEMA MATTERS MORE THAN IT LOOKS ─────────────────────────────────────────────
 * The chamber's hologram is a DRILL-DOWN: `FaqHologram` renders a ternary — the list of questions OR
 * one answer, never both — so `openEntry` starting `null` means **not one word of an answer reaches
 * the HTML**. Measured 2026-08-13: 7 questions, 0 answers. That is the most search-valuable prose on
 * the site and none of it was indexable.
 *
 * This puts the questions AND the answers in the page in a form a crawler reads directly, without
 * restructuring a scene component whose arrival choreography is load-bearing. Google's requirement is
 * that the content be reachable by the visitor on that page, and it is — every answer is one click
 * away in the hologram. That is an accordion, which is exactly the case the guidance permits.
 *
 * ⚠ It is NOT a substitute for putting the answers in the DOM, and it should not be treated as one.
 * It is the safe half, shipped first on purpose — see `docs/cms-integration-plan.md` ⑤c.
 *
 * ── ⚠ EVERYTHING HERE IS BUILT FROM RESOLVED CONTENT, NEVER FROM THE FALLBACK CONSTANTS ─────────
 * The schema has to describe what the page actually says. Reading `FAQ_ENTRIES` directly would
 * describe this repo's placeholder copy while the page rendered the panel's, and a mismatch between
 * structured data and visible content is the one thing that gets rich results withdrawn.
 */

import type { FaqEntry } from '@/components/sections/Chamber/faqEntries';
import {
  LINKEDIN_PROFILE_URL,
  PUBLIC_EMAIL_ADDRESS,
  SITE_NAME,
  SITE_URL,
} from '@/lib/siteMetadata';

export function buildOrganizationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: SITE_URL,
    description:
      'Voidix builds custom websites, web applications, CRM platforms, mobile apps, SaaS products, AI tools, and workflow automation for businesses across the United States.',
    logo: `${SITE_URL}/icon.png`,
    email: PUBLIC_EMAIL_ADDRESS,
    // `sameAs` is an ownership claim, so only profiles confirmed by the studio belong here.
    sameAs: [LINKEDIN_PROFILE_URL],
  };
}

export function buildFaqSchema(faqEntries: FaqEntry[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqEntries.map((entry) => ({
      '@type': 'Question',
      name: entry.question,
      acceptedAnswer: {
        '@type': 'Answer',
        // The hologram renders one paragraph per string; the schema wants one body, so they are
        // joined with a blank line rather than concatenated into a wall.
        text: entry.answer.join('\n\n'),
      },
    })),
  };
}

/**
 * Serialises a schema for `dangerouslySetInnerHTML`.
 *
 * ⚠ The `<` escape is not decoration. Content comes from the admin panel, and a `</script>` inside
 * any published string would otherwise close this tag early and put the remainder of the payload into
 * the document as markup. `toPlainLine` strips HTML on save, but the site must not depend on the
 * panel's sanitiser for its own injection safety — two systems, one of which can be changed without
 * the other knowing.
 */
export function serialiseSchema(schema: object): string {
  return JSON.stringify(schema).replace(/</g, '\\u003c');
}
