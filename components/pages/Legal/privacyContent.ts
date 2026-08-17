/**
 * Everything `/privacy` says.
 *
 * ── ⚠ THIS IS NOT A TEMPLATE. EVERY CLAIM BELOW WAS READ OUT OF THE CODE ────────────────────────
 * A privacy notice that describes a site nobody built is worse than none, because it is a documented
 * promise about the wrong system. Each statement here traces to a file, and the trace is recorded so
 * the next person can re-check it rather than re-derive it:
 *
 *   "no analytics, no cookies"      grep for `document.cookie|gtag|analytics|posthog|plausible`
 *                                   across app/, components/, lib/ returns nothing. 2026-08-17.
 *   the one localStorage key        `lib/motionPreference.ts` — `voidix:motion-preference`, holding
 *                                   `{ choice, systemReduced }`. No identifier, never transmitted.
 *   fonts are self-hosted           `next/font/google` in `app/layout.tsx` downloads at BUILD time
 *                                   and emits woff2 into `.next/static/media/`. The visitor's browser
 *                                   never contacts Google. This is the Google-Fonts-CDN question and
 *                                   the answer here is genuinely favourable — do not lose it by
 *                                   switching to a <link> tag.
 *   the enquiry fields              `app/api/enquiry/route.ts` → `lib/cms/panelIntake.ts`.
 *   the application fields + CV     `app/api/application/route.ts` — the PDF goes to UploadThing
 *                                   server-side and the panel receives only a URL.
 *   the rate limit sees an address  `PanelIntakeResult`'s `rate-limited` branch: "too many
 *                                   submissions from this address in an hour" is the panel's rule.
 *
 * ⚠ CHANGE THE CODE, CHANGE THIS FILE IN THE SAME SITTING. Adding one analytics script makes section
 * 03 false, and section 03 is the strongest thing this document says.
 *
 * ── ⚠ WHAT IS A PLACEHOLDER, AND IT MUST BE FILLED BEFORE THIS GOES LIVE ────────────────────────
 * Everything in square brackets. The studio has no registered legal entity yet, so the controller's
 * identity, its address and the jurisdiction it answers in are not facts this file can state — and
 * `contactContent.ts` set the precedent that we do not ship a claim we cannot hold.
 *
 * The brackets are deliberately visible on the page rather than quietly omitted. A privacy notice
 * with a blank where the controller should be is obviously unfinished; one that simply never names a
 * controller reads as complete and is not.
 *
 * ⚠ `PRIVACY_CONTACT` is ALSO a placeholder, and for a second reason: `contactContent.ts` still says
 * `hello@voidix.studio` while `lib/siteMetadata.ts` says the domain is `voidix.tech`. Fix both in one
 * change or this document will name an address the footer contradicts.
 */

import type { LegalDocument } from './legalDocument';

/** ⚠ Placeholder. The address a rights request goes to — see the header. */
const PRIVACY_CONTACT = '[privacy@voidix.tech — confirm this mailbox exists]';

/** ⚠ Placeholder. The controller's registered identity, once there is one. */
const CONTROLLER = '[Registered entity name and address — not yet incorporated]';

export const PRIVACY_DOCUMENT: LegalDocument = {
  eyebrow: 'Privacy',
  title: ['What this site', 'knows about you.'],
  lead:
    'Almost nothing, and this page is the specific version of that sentence. No analytics, no cookies, no tracking — only what you type into a form, and only when you send it.',
  lastReviewed: '2026-08-17',

  sections: [
    {
      meta: { key: 'scope', number: '01', title: 'Who this is, and what it covers' },
      paragraphs: [
        `This notice covers voidix.tech and every page on it. The studio operating this site is the party responsible for the information described below — in data-protection language, the controller: ${CONTROLLER}.`,
        `Write to ${PRIVACY_CONTACT} about anything on this page, including any of the rights in section 06. A request costs you nothing and does not have to be in any particular form.`,
      ],
      note:
        'The bracketed details above are unfinished on purpose. The studio is not yet a registered company, and naming one before it exists would be the first thing on this site we could not back.',
    },

    {
      meta: { key: 'collected', number: '02', title: 'What the site collects' },
      paragraphs: [
        'Three things, and two of them only happen because you chose to send them. There is no fourth — nothing here is gathered in the background while you browse.',
      ],
      points: [
        {
          term: 'When you send an enquiry',
          detail:
            'Your email address, which is the only required field, plus anything else you choose to add: a name, a phone number, what you are looking to build, and a note of which part of the site you opened the form from. It arrives in an inbox and stops there — it becomes a business contact only if someone at the studio decides it should.',
        },
        {
          term: 'When you apply for a role',
          detail:
            'Your name, your email address, why you are writing, and the work you want read — a link, a CV as a PDF of up to 5 MB, or both. Optionally a phone number, and a note of which role you applied to. Applications are kept apart from enquiries and cannot cross into the studio’s business contacts.',
        },
        {
          term: 'When you set a motion preference',
          detail:
            'One entry in your browser’s local storage recording whether you asked the site to reduce its animation. It contains no name, no identifier and nothing that could distinguish you from anyone else with the same setting, and it is never sent anywhere. Clearing your browser data removes it.',
        },
      ],
      note:
        'Two things happen at the network layer that are worth naming even though the site does not choose them: our host records ordinary server logs, and the system receiving form submissions applies a rate limit based on the network address a submission came from, so that one sender cannot flood it.',
    },

    {
      meta: { key: 'never', number: '03', title: 'What the site never does' },
      paragraphs: [
        'This section is the short one, and it is the reason the rest of the page is short.',
      ],
      points: [
        {
          detail:
            'There is no analytics on this site. No Google Analytics, no Tag Manager, no Plausible, no Vercel Analytics, no self-hosted equivalent. Nobody, including us, is counting your visit.',
        },
        {
          detail:
            'There are no cookies. Not necessary ones, not preference ones, not any — which is why you have never seen a consent banner here and why there is nothing for one to ask about.',
        },
        {
          detail:
            'There are no third-party tags, pixels, embeds, share widgets or advertising networks anywhere in the page.',
        },
        {
          detail:
            'The typefaces are served from this site’s own domain, not from a font network. Loading a page here does not tell anyone else that you did.',
        },
        {
          detail:
            'Nothing you send is ever sold, rented, brokered, or handed to anyone for their own marketing. There is no profiling and no automated decision-making about you.',
        },
      ],
    },

    {
      meta: { key: 'processors', number: '04', title: 'Who else handles it' },
      paragraphs: [
        'A form submission touches three systems on its way to a person, and each of them only ever sees what it needs to do its part.',
      ],
      points: [
        {
          term: 'The studio’s admin panel',
          detail:
            'Where enquiries and applications are read. It holds the text of what you sent and, for an application, a link to your CV rather than the file itself.',
        },
        {
          term: 'UploadThing',
          detail:
            'Where a CV file is stored, if you attach one. It is uploaded by our server rather than by your browser, and it is the only place the file itself lives.',
        },
        {
          term: 'Our hosting provider',
          detail:
            'Serves the pages and keeps ordinary server logs of requests, as every web host does. It never sees form contents as anything other than traffic in transit.',
        },
      ],
      note:
        '⚠ The exact companies behind the panel’s database and the hosting are still to be named here. Until they are, this section describes what each system does but not who runs it, and that gap should be closed before the studio is trading.',
    },

    {
      meta: { key: 'retention', number: '05', title: 'How long it is kept' },
      paragraphs: [
        'There is no fixed number of months on this page, because the studio does not yet run a deletion schedule it could honestly promise to keep. Stating one we did not follow would be worse than stating none.',
        'What governs it instead: an enquiry is kept while the conversation it started is live, and for as long afterwards as we may reasonably need to remember it — a returning client picking up an old thread, or a record of what was agreed. An application is kept while the role is open and for a reasonable period after it closes, so that a strong candidate can be reconsidered for the next one. A CV is deleted when the application it belongs to is.',
      ],
      note:
        'You do not have to wait for any of that. Ask us to delete what we hold and we will, on the terms in section 06.',
    },

    {
      meta: { key: 'rights', number: '06', title: 'Your rights' },
      paragraphs: [
        'These are granted to everyone who writes to us, wherever you are. Drawing a line by country would mean sorting people by passport before answering a one-sentence request, and the request is easier to honour than the sorting.',
      ],
      points: [
        {
          term: 'Ask what we hold',
          detail: 'We will send you everything associated with your address, in a readable form.',
        },
        {
          term: 'Correct it',
          detail: 'If something is wrong, tell us what it should say and we will change it.',
        },
        {
          term: 'Have it deleted',
          detail:
            'We will remove it, including any CV file, unless there is a specific legal reason we must keep a record — in which case we will tell you what and why.',
        },
        {
          term: 'Take it with you',
          detail: 'We will provide what you sent us in a common machine-readable format.',
        },
        {
          term: 'Object, or ask us to pause',
          detail:
            'You can tell us to stop using what we hold, or to restrict it to storage only, while a question is resolved.',
        },
        {
          term: 'Complain to a regulator',
          detail:
            'If we handle a request badly you can take it to the data-protection authority where you live. We would rather you told us first, but that is your choice and not a precondition.',
        },
      ],
      note:
        'Requests are answered within one month. We will not charge you, and we will not ask you to justify the request.',
    },

    {
      meta: { key: 'law', number: '07', title: 'Where you stand in law' },
      paragraphs: [
        'This notice is written to the standard of the EU and UK General Data Protection Regulation, which is the strictest of the regimes that could apply and the one that grants you the most. Where you are covered by it, the lawful bases are straightforward: we handle an enquiry or an application because you asked us to and because the studio has a legitimate interest in answering, and we keep a CV only for the purpose you sent it for.',
        'Where the studio’s operations are established in Egypt, Law 151 of 2018 on the Protection of Personal Data applies alongside. Its rights — to be informed, to access, to correct, to erase, and to object — are materially the ones set out in section 06, and where the two regimes differ we will apply whichever gives you more.',
      ],
      note:
        '⚠ Egyptian law also requires a controller to register with the Data Protection Centre once trading, and the executive regulations giving effect to Law 151 have not been issued at the time of writing. This page therefore states which law applies and what you are owed under it; it does not claim a registration the studio does not yet hold.',
    },

    {
      meta: { key: 'changes', number: '08', title: 'Changes to this notice' },
      paragraphs: [
        'When this document changes, the review date at the top of the page changes with it. That date moves when the words move and at no other time — it is not a build stamp, so a deploy that changes nothing here will not make this page look freshly considered.',
        'If a change ever means we start doing something this page currently says we do not — an analytics script, a cookie, a new recipient for what you send — we will say so plainly here rather than adjusting a sentence and hoping it reads the same.',
      ],
    },
  ],

  closingTitle: 'Ask us anything about this.',
  closingLead: `Every right on this page is exercised by writing one email. ${PRIVACY_CONTACT}`,
};
