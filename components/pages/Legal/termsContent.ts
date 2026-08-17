/**
 * Everything `/terms` says.
 *
 * ── ⚠ THE SAME RULE AS `privacyContent.ts`: NOTHING HERE IS BOILERPLATE ─────────────────────────
 * A terms page is where a studio site is most tempted to paste something generic, and the paste is
 * how sites end up claiming rights over work applicants send them, or disclaiming warranties for
 * products they do not sell. Every clause below is about THIS site: a portfolio with two forms on it
 * and no account, no payment, no subscription and nothing to buy.
 *
 * ⚠ Section 04 is the one to read before editing. The default clause a template supplies for
 * "material you submit" grants the site an irrevocable worldwide licence over it — which, on a page
 * that accepts CVs and links to a candidate's portfolio, would be the studio helping itself to the
 * work of everyone who applies. It says the opposite on purpose.
 *
 * ── ⚠ PLACEHOLDERS ─────────────────────────────────────────────────────────────────────────────
 * Everything in square brackets, same convention and same reason as the privacy notice: there is no
 * registered entity yet, so there is no governing jurisdiction to name. Visible on the page rather
 * than omitted, because a terms page with an obvious gap is unfinished and one with no governing-law
 * clause at all just looks finished.
 *
 * ── ⚠ ON THE CC-BY CREDIT IN SECTION 05 ────────────────────────────────────────────────────────
 * `PageFooter`'s header is right that the attribution for `black_hole.glb` belongs where the model
 * appears, which is the contact section, and that copying it onto pages that do not show it would be
 * claiming to display something we don't. That remains the compliance point. This is a different
 * thing: a licence disclosure, listing what the site is built out of. It does not replace the footer
 * credit and the footer credit must not be removed because this exists.
 */

import type { LegalDocument } from './legalDocument';

/** ⚠ Placeholder — see the header. The courts and law that would govern a dispute. */
const JURISDICTION = '[governing law and courts — pending incorporation]';

/** ⚠ Placeholder. Kept identical to the privacy notice's contact; fix both together. */
const LEGAL_CONTACT = '[legal@voidix.tech — confirm this mailbox exists]';

export const TERMS_DOCUMENT: LegalDocument = {
  eyebrow: 'Terms',
  title: ['The terms', 'of using this.'],
  lead:
    'A short set, because this is a portfolio rather than a product. There is nothing to buy here, no account to open and no subscription to cancel — most of what follows is about who owns what.',
  lastReviewed: '2026-08-17',

  sections: [
    {
      meta: { key: 'agreement', number: '01', title: 'What you are agreeing to' },
      paragraphs: [
        'Using voidix.tech means accepting the terms on this page. If you do not, the remedy is simply to close the tab — nothing here asks you to register, pay or commit to anything else.',
        `These terms cover the website only. If the studio goes on to do paid work for you, that work is governed by a separate written agreement signed by both sides, and where the two ever disagree, that agreement wins. Questions about this page go to ${LEGAL_CONTACT}.`,
      ],
    },

    {
      meta: { key: 'demonstration', number: '02', title: 'The site is a demonstration, not an offer' },
      paragraphs: [
        'Everything shown here — the work, the capabilities, the way a project is described as running — is a portfolio. None of it is a contractual offer, a quotation, or a promise of a result, and no page on this site creates an obligation on either of us.',
        'Sending an enquiry does not commit you to anything and does not commit the studio to take the work. A brief you send is read by a person, not entered into a pipeline, and either of us may simply decide not to proceed.',
      ],
      note:
        'Descriptions of past projects on this site may be illustrative while the studio’s real work is being published. Where a project is a placeholder, it is not a claim to have delivered it.',
    },

    {
      meta: { key: 'ours', number: '03', title: 'What belongs to the studio' },
      paragraphs: [
        'The design, code, copy, three-dimensional work, animation and overall composition of this site are the studio’s, or are used under the licences named in section 05. Viewing the site does not transfer any of it.',
        'You are welcome to look at how it is built — this is a site that invites exactly that, and reading the source of a page you have loaded is not something these terms restrict. What you may not do is copy the site wholesale, reproduce it as your own or a client’s, or present its work as yours.',
      ],
      points: [
        {
          detail:
            'Do not scrape, mirror or bulk-download the site, or use automated means to do so at a rate that degrades it for anyone else.',
        },
        {
          detail:
            'Do not use the site’s content to train a model that reproduces it, or resell it in any form.',
        },
        {
          detail:
            'Do not attempt to break, overload or gain unauthorised access to the site or the systems behind its forms.',
        },
      ],
    },

    {
      meta: { key: 'yours', number: '04', title: 'What belongs to you' },
      paragraphs: [
        'Everything you send us stays yours. A brief, a CV, a portfolio link, a case study, a piece of work you attach to an application — the studio claims no ownership of any of it and acquires no licence to use it beyond the purpose you sent it for.',
        'That purpose is narrow and it is the whole of it: to read what you sent, to reply to you, and — for an application — to assess you for the role. Your work is not shown to anyone outside the studio, not published, not used as an example, and not used to promote anything.',
      ],
      note:
        'If we ever want to show something you sent us, we will ask you first and take no for an answer. This paragraph exists because the standard clause in most terms pages says the opposite of it.',
    },

    {
      meta: { key: 'licences', number: '05', title: 'Third-party work on this site' },
      paragraphs: [
        'This site is built partly out of work by other people, used under licence. Naming it is both an obligation and the honest thing to do.',
      ],
      points: [
        {
          term: 'Black Hole, by NestaEric',
          detail:
            'The three-dimensional model used in the contact section, licensed under Creative Commons Attribution 4.0. The credit shown alongside the model itself is the attribution the licence requires.',
        },
        {
          term: 'Syne and DM Sans',
          detail:
            'The two typefaces, used under the SIL Open Font License and served from this site’s own domain rather than from a font network.',
        },
        {
          term: 'Open-source libraries',
          detail:
            'The site runs on Next.js, React, Three.js and GSAP among others, each under its own licence. Nothing in section 03 claims rights over any of them.',
        },
      ],
    },

    {
      meta: { key: 'warranty', number: '06', title: 'What is not promised' },
      paragraphs: [
        'The site is provided as it is. It leans hard on real-time graphics and it is honest about that: on an older machine, a constrained browser or a poor connection, parts of it may run slowly or not at all. A text version of the same content is available for exactly that case.',
        'We do not promise that the site will be available without interruption, that it will be free of errors, or that any information on it is complete or current at the moment you read it. Where the law does not allow those things to be excluded, nothing here excludes them.',
      ],
    },

    {
      meta: { key: 'liability', number: '07', title: 'Limits' },
      paragraphs: [
        'The studio is not liable for loss arising from your use of this website — for instance, from relying on something described here, or from the site being unavailable when you wanted it. This is a portfolio site with nothing to purchase, and the limit is drawn accordingly.',
        'Nothing here limits liability for death or personal injury caused by negligence, for fraud, or for anything else that cannot lawfully be limited. If a paid engagement is agreed, its own contract sets the liability position for that work, not this page.',
      ],
    },

    {
      meta: { key: 'law', number: '08', title: 'Changes, and which law applies' },
      paragraphs: [
        `These terms are governed by ${JURISDICTION}. The bracket is not an oversight: the studio is not yet incorporated, so there is no jurisdiction it can honestly name, and inventing one would be a claim about where you would have to bring a dispute.`,
        'When these terms change, the review date at the top of the page changes with them. Continuing to use the site after that means accepting the version then published. If a court finds any single clause here unenforceable, the rest continues to apply.',
      ],
    },
  ],

  closingTitle: 'Anything unclear here, ask.',
  closingLead: `These are meant to be read, not clicked past. ${LEGAL_CONTACT}`,
};
