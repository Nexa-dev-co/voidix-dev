# Supporting Pages Content Workbook

Source note: this workbook covers `/lite`, `/privacy`, and `/terms`. Unlike `/about` and `/careers`, these pages are not represented in the fetched CMS payload. Their content currently lives in `components/pages/Lite/liteContent.ts`, `components/pages/Lite/LitePage.tsx`, `components/pages/Legal/privacyContent.ts`, and `components/pages/Legal/termsContent.ts`.

Usage note: each row holds one sentence, one label, or one list item. Fill `New` and `Suggestions` as needed.

## Lite Page

| Field | Current | New | Suggestions | Source/Notes |
| --- | --- | --- | --- | --- |
| Route | `/lite` |  | Keep as is. | Text fallback for weak connections. |
| Eyebrow | No download required |  | Fast text version | Hardcoded in `liteContent.ts`. |
| Title sentence 1 | Everything the site says. |  | What Voidix builds. | Hardcoded in `liteContent.ts`. |
| Title sentence 2 | None of what it had to load. |  | Without the 3D download. | Hardcoded in `liteContent.ts`. |
| Lead sentence 1 | The homepage is a ten-megabyte argument for what we can build - four WebGL scenes and one continuous flight through them. |  | Voidix is a custom software studio that builds websites, web applications, SaaS platforms, mobile apps, CRM and internal systems, integrations, digital product experiences, and practical AI. | Hardcoded in `liteContent.ts`. |
| Lead sentence 2 | This is the same argument in text. |  | The full homepage demonstrates our 3D, motion, interaction, and performance engineering in one continuous experience. | Hardcoded in `liteContent.ts`. |
| Lead sentence 3 | Same services, same work, same answers, nothing to download and nothing to wait for. |  | This version contains the same services, project examples, answers, and contact path with almost nothing to wait for. | Hardcoded in `liteContent.ts`. |
| Section 01 title | What we build |  | Services | Hardcoded structure in `LITE_SECTIONS`. |
| Section 02 title | Selected work |  | Selected work | Hardcoded structure in `LITE_SECTIONS`. |
| Section 03 title | Questions |  | Frequently asked questions | Hardcoded structure in `LITE_SECTIONS`. |
| Close anchor | contact |  | Keep `contact`; it is a structural anchor key. | Hardcoded in `LITE_CLOSE_ANCHOR`. |
| Closing title | The flight is still there. |  | Want to see the full experience? | Hardcoded in `liteContent.ts`. |
| Closing lead sentence 1 | Nothing on this page is a summary. |  | You now have the complete content in its fastest form. | Hardcoded in `liteContent.ts`. |
| Closing lead sentence 2 | It is the same words, without the scene they normally arrive in - so when you are on a connection that will carry it, the full site is still worth the ten megabytes. |  | When your connection and device are ready, the full site adds the WebGL scenes, custom motion, and continuous journey that show how Voidix handles ambitious frontend work. | Hardcoded in `liteContent.ts`. |
| Full site invite | Take the full site |  | Open the full experience | Hardcoded in `liteContent.ts`. |
| Whole-studio enquiry eyebrow | Start a project |  | Start a project | Hardcoded in `LitePage.tsx`. |
| Service action label | Start this build |  | Discuss this service | Hardcoded in `LitePage.tsx`. |
| Project action label | Start one like this |  | Discuss a similar project | Hardcoded in `LitePage.tsx`. |
| FAQ action label | Ask us anything |  | Ask a question | Hardcoded in `LitePage.tsx`. |
| FAQ enquiry brief label | Your question |  | What would you like to know? | Hardcoded in `LitePage.tsx`. |
| FAQ enquiry submit label | Send the question |  | Send question | Hardcoded in `LitePage.tsx`. |
| Close CTA label | Start a project |  | Tell us what you need | Hardcoded in `LitePage.tsx`. |

## Privacy Page

| Field | Current | New | Suggestions | Source/Notes |
| --- | --- | --- | --- | --- |
| Route | `/privacy` |  | Keep as is. | Hardcoded legal document. |
| Eyebrow | Privacy |  | Privacy | `PRIVACY_DOCUMENT` |
| Title sentence 1 | What this site |  | How Voidix handles | `PRIVACY_DOCUMENT`; title line is intentionally split. |
| Title sentence 2 | knows about you. |  | your information. | `PRIVACY_DOCUMENT`; title line is intentionally split. |
| Lead sentence 1 | Less than you would expect, and this page is the specific version of that. |  | This notice explains exactly what voidix.tech collects, why it is collected, and what choices you have. | `PRIVACY_DOCUMENT` |
| Lead sentence 2 | No third-party analytics, no advertising, nothing sold. |  | We use no third-party analytics or advertising, and we do not sell personal information. | `PRIVACY_DOCUMENT` |
| Lead sentence 3 | We count how far people get, anonymously; one thing needs your permission, and this page is blunt about which. |  | We collect anonymous usage measurements for every visit. With your permission, we add a returning-visitor ID and record detailed cursor paths. | `PRIVACY_DOCUMENT` |
| Last reviewed | 2026-08-17 |  | Update this date only when the notice or the behavior it describes changes. | `PRIVACY_DOCUMENT` |
| Placeholder contact | [privacy@voidix.tech - confirm this mailbox exists] |  | Launch blocker: replace with the confirmed privacy mailbox before publication. | `PRIVACY_CONTACT`; must be confirmed before launch. |
| Placeholder controller | [Registered entity name and address - not yet incorporated] |  | Launch blocker: replace with the registered entity name and business address once confirmed. | `CONTROLLER`; must be replaced before launch. |

### Privacy Sections

| Section | Current | New | Suggestions | Source/Notes |
| --- | --- | --- | --- | --- |
| 01 title | Who this is, and what it covers |  | Who is responsible and what this covers | Hardcoded section metadata. |
| 01 sentence 1 | This notice covers voidix.tech and every page on it. |  | This notice applies to voidix.tech and every page on the site. | Paragraph 1. |
| 01 sentence 2 | The studio operating this site is the party responsible for the information described below - in data-protection language, the controller: [Registered entity name and address - not yet incorporated]. |  | The business operating this site is responsible for the information described below and is the data controller: [replace with the confirmed registered entity name and address]. | Paragraph 1 with placeholder. |
| 01 sentence 3 | Write to [privacy@voidix.tech - confirm this mailbox exists] about anything on this page, including any of the rights in section 07. |  | Contact [replace with the confirmed privacy mailbox] with questions or to exercise any right in section 07. | Paragraph 2 with placeholder. |
| 01 sentence 4 | A request costs you nothing and does not have to be in any particular form. |  | You do not have to use a specific form or pay a fee to make a request. | Paragraph 2. |
| 02 title | What the site collects |  | What we collect | Hardcoded section metadata. |
| 02 intro sentence | Six things, and the first two only happen because you chose to send them. |  | The site collects six categories of information. The first two exist only when you choose to submit them. | Paragraph. |
| 02 intro sentence | The rest are counts about how the site was used rather than about you - no name, no address, and nothing that could pick you out of the people who visited the same day. |  | The remaining categories are browser preferences or anonymous usage measurements and are not connected to a name, email address, or network address. | Paragraph. |
| 02 point | When you send an enquiry |  | Information in a project inquiry | Point heading. |
| 02 point | When you apply for a role |  | Information in a job application | Point heading. |
| 02 point | When you set a motion preference |  | Your motion preference | Point heading. |
| 02 point | When you answer the cookie bar |  | Your analytics choice | Point heading. |
| 02 point | While you are using the site |  | Anonymous site-usage measurements | Point heading. |
| 02 point | Where your cursor goes |  | Anonymous cursor heatmaps | Point heading. |
| 03 title | The one thing we ask permission for |  | What requires your permission | Hardcoded section metadata. |
| 03 sentence 1 | Everything in the previous section happens for everybody, because none of it can pick a person out of a crowd. |  | The anonymous measurements in section 02 run for every visitor and are not linked across visits. | Paragraph 1. |
| 03 sentence 2 | This is the exception, and it is the only reason there is a bar at all. |  | Detailed cursor-path recording and a returning-visitor ID are the exceptions, so we ask first. | Paragraph 1. |
| 03 sentence 3 | If you allow it, we record the actual path your cursor takes across the page - not just where it rested, but the route it took to get there, several times a second. |  | If you agree, we record the path your cursor takes across the page several times per second, not only the areas where it rests. | Paragraph 2. |
| 03 sentence 4 | That is close to watching a recording of your visit, and we would rather say so in those words than describe it as "cursor data" and let you find out later. |  | A cursor path can resemble a partial recording of how you moved through the site, so this notice describes it plainly. | Paragraph 2. |
| 03 sentence 5 | It is worth being blunt about why it needs asking: the way a person moves a mouse - the speed, the small corrections, the pauses - is distinctive enough to be a way of recognising them. |  | Mouse speed, pauses, and small corrections can be distinctive enough to help recognize a returning person, which is why this collection requires permission. | Paragraph 2. |
| 03 sentence 6 | Nothing else on this page has that property. |  | The anonymous measurements described earlier do not have that property. | Paragraph 2. |
| 04 title | What the site never does |  | What we do not do | Hardcoded section metadata. |
| 04 sentence | This section is the short one, and it is the reason the rest of the page is short. |  | The site deliberately avoids the following tracking and advertising practices. | Paragraph. |
| 04 point | No third-party analytics touches this site. |  | We do not use third-party analytics. | Point detail first sentence. |
| 04 point | There are no cookies - nothing is written to a cookie, and nothing about you is sent along with every request. |  | We do not write browser cookies; the optional returning-visitor ID is stored in local storage only after permission. | Point detail first sentence. |
| 04 point | There are no third-party tags, pixels, embeds, share widgets or advertising networks anywhere in the page. |  | We use no third-party tracking tags, advertising pixels, embedded share widgets, or advertising networks. | Point detail. |
| 04 point | The typefaces are served from this site's own domain, not from a font network. |  | The site serves its fonts from its own domain instead of contacting a font network. | Point detail first sentence. |
| 04 point | Nothing you send is ever sold, rented, brokered, or handed to anyone for their own marketing. |  | We do not sell, rent, broker, or share submitted information for another company's marketing. | Point detail first sentence. |
| 05 title | Who else handles it |  | Service providers that handle information | Hardcoded section metadata. |
| 05 sentence | A form submission touches three systems on its way to a person, and each of them only ever sees what it needs to do its part. |  | A form submission passes through three systems, and each system receives only the information needed for its role. | Paragraph. |
| 05 point | The studio's admin panel |  | Voidix's admin panel | Processor heading. |
| 05 point | UploadThing |  | UploadThing | Processor heading. |
| 05 point | Our hosting provider |  | Website hosting provider | Processor heading. |
| 06 title | How long it is kept |  | How long we keep information | Hardcoded section metadata. |
| 06 sentence 1 | The measurement described in sections 02 and 03 is deleted after 90 days. |  | Site-usage measurements and cursor records are deleted after 90 days. Publish this claim only after the scheduled deletion job is confirmed live. | Paragraph 1. |
| 06 sentence 2 | Not archived, not anonymised further - the individual records are removed, and what survives is a daily count of how many people did a thing, which no longer relates to any visit in particular. |  | Individual records are removed rather than archived. Only daily totals that cannot be connected to a particular visit remain. | Paragraph 1. |
| 06 sentence 3 | Cursor paths go on the same 90-day clock, and go immediately if you withdraw. |  | If you withdraw permission, cursor paths connected to your visitor ID are deleted immediately. | Paragraph 1. |
| 07 title | Your rights |  | Your privacy rights | Hardcoded section metadata. |
| 07 point | Ask what we hold |  | Request a copy | Rights heading. |
| 07 point | Correct it |  | Correct inaccurate information | Rights heading. |
| 07 point | Have it deleted |  | Request deletion | Rights heading. |
| 07 point | Take it with you |  | Request a portable copy | Rights heading. |
| 07 point | Object, or ask us to pause |  | Object or restrict processing | Rights heading. |
| 07 point | Complain to a regulator |  | Complain to a regulator | Rights heading. |
| 08 title | Where you stand in law |  | Applicable data protection law | Hardcoded section metadata. |
| 09 title | Changes to this notice |  | Changes to this notice | Hardcoded section metadata. |
| Closing title | Ask us anything about this. |  | Questions or privacy requests | `PRIVACY_DOCUMENT` |
| Closing lead | Every right on this page is exercised by writing one email. [privacy@voidix.tech - confirm this mailbox exists] |  | Contact [replace with the confirmed privacy mailbox] to ask a question or exercise any right described on this page. | `PRIVACY_DOCUMENT` with placeholder. |

## Terms Page

| Field | Current | New | Suggestions | Source/Notes |
| --- | --- | --- | --- | --- |
| Route | `/terms` |  | Keep as is. | Hardcoded legal document. |
| Eyebrow | Terms |  | Terms | `TERMS_DOCUMENT` |
| Title sentence 1 | The terms |  | Terms for using | `TERMS_DOCUMENT`; title line is intentionally split. |
| Title sentence 2 | of using this. |  | the Voidix website. | `TERMS_DOCUMENT`; title line is intentionally split. |
| Lead sentence 1 | A short set, because this is a portfolio rather than a product. |  | These terms apply to the Voidix portfolio website. | `TERMS_DOCUMENT` |
| Lead sentence 2 | There is nothing to buy here, no account to open and no subscription to cancel - most of what follows is about who owns what. |  | The site sells nothing directly, creates no user account, and offers no subscription. Most of these terms explain ownership and acceptable use. | `TERMS_DOCUMENT` |
| Last reviewed | 2026-08-17 |  | Update this date only when the terms change. | `TERMS_DOCUMENT` |
| Placeholder jurisdiction | [governing law and courts - pending incorporation] |  | Launch blocker: replace with the confirmed governing law and courts after incorporation. | `JURISDICTION`; must be replaced before launch. |
| Placeholder contact | [legal@voidix.tech - confirm this mailbox exists] |  | Launch blocker: replace with the confirmed legal mailbox before publication. | `LEGAL_CONTACT`; must be confirmed before launch. |

### Terms Sections

| Section | Current | New | Suggestions | Source/Notes |
| --- | --- | --- | --- | --- |
| 01 title | What you are agreeing to |  | Acceptance and scope | Hardcoded section metadata. |
| 01 sentence 1 | Using voidix.tech means accepting the terms on this page. |  | By using voidix.tech, you agree to these website terms. | Paragraph 1. |
| 01 sentence 2 | If you do not, the remedy is simply to close the tab - nothing here asks you to register, pay or commit to anything else. |  | If you do not agree, stop using the site. The website does not require registration, payment, or any other commitment. | Paragraph 1. |
| 01 sentence 3 | These terms cover the website only. |  | These terms apply only to the website. | Paragraph 2. |
| 01 sentence 4 | If the studio goes on to do paid work for you, that work is governed by a separate written agreement signed by both sides, and where the two ever disagree, that agreement wins. |  | Any paid project is governed by a separate written agreement signed by both parties. If that agreement conflicts with these website terms, the project agreement controls the paid work. | Paragraph 2. |
| 02 title | The site is a demonstration, not an offer |  | Portfolio information is not a contract | Hardcoded section metadata. |
| 02 sentence 1 | Everything shown here - the work, the capabilities, the way a project is described as running - is a portfolio. |  | The projects, services, capabilities, schedules, and working methods shown on this site are portfolio information. | Paragraph 1. |
| 02 sentence 2 | None of it is a contractual offer, a quotation, or a promise of a result, and no page on this site creates an obligation on either of us. |  | Nothing on the site is a contractual offer, quotation, guarantee, or promise of a particular result. | Paragraph 1. |
| 02 sentence 3 | Sending an enquiry does not commit you to anything and does not commit the studio to take the work. |  | Sending an inquiry does not commit you to hire Voidix or require Voidix to accept the project. | Paragraph 2. |
| 02 sentence 4 | A brief you send is read by a person, not entered into a pipeline, and either of us may simply decide not to proceed. |  | A submitted brief enters the inquiry inbox for review. It becomes a business contact only if Voidix chooses to continue the conversation, and either side may decide not to proceed. | Paragraph 2. |
| 03 title | What belongs to the studio |  | Voidix website ownership | Hardcoded section metadata. |
| 03 sentence 1 | The design, code, copy, three-dimensional work, animation and overall composition of this site are the studio's, or are used under the licences named in section 05. |  | Voidix owns the website's original design, code, copy, 3D work, animation, and composition, except for material used under the licenses listed in section 05. | Paragraph 1. |
| 03 sentence 2 | Viewing the site does not transfer any of it. |  | Viewing or using the website does not transfer ownership or grant a license to copy it. | Paragraph 1. |
| 03 sentence 3 | You are welcome to look at how it is built - this is a site that invites exactly that, and reading the source of a page you have loaded is not something these terms restrict. |  | You may inspect the source code delivered to your browser and study how the public page works. | Paragraph 2. |
| 03 sentence 4 | What you may not do is copy the site wholesale, reproduce it as your own or a client's, or present its work as yours. |  | You may not reproduce the website as your own or a client's work, copy it substantially, or present any part of it as work you created. | Paragraph 2. |
| 04 title | What belongs to you |  | Ownership of what you submit | Hardcoded section metadata. |
| 04 sentence 1 | Everything you send us stays yours. |  | You keep ownership of everything you submit. | Paragraph 1. |
| 04 sentence 2 | A brief, a CV, a portfolio link, a case study, a piece of work you attach to an application - the studio claims no ownership of any of it and acquires no licence to use it beyond the purpose you sent it for. |  | Voidix claims no ownership of a brief, CV, portfolio link, case study, or other work you submit and may use it only for the purpose for which you sent it. | Paragraph 1. |
| 04 sentence 3 | That purpose is narrow and it is the whole of it: to read what you sent, to reply to you, and - for an application - to assess you for the role. |  | We may review the material, reply to you, and, for a job application, assess your fit for the role. | Paragraph 2. |
| 04 sentence 4 | Your work is not shown to anyone outside the studio, not published, not used as an example, and not used to promote anything. |  | We do not publish submitted work, use it as a portfolio example, use it for promotion, or show it outside Voidix. | Paragraph 2. |
| 05 title | Third-party work on this site |  | Third-party material and licenses | Hardcoded section metadata. |
| 05 sentence | This site is built partly out of work by other people, used under licence. |  | The website includes third-party material used under license. | Paragraph. |
| 05 sentence | Naming it is both an obligation and the honest thing to do. |  | The relevant creators, software, and licenses are identified below. | Paragraph. |
| 05 point | Black Hole, by NestaEric |  | Black Hole by NestaEric | Licence disclosure heading. |
| 05 point | Syne and DM Sans |  | Syne and DM Sans | Licence disclosure heading. |
| 05 point | Open-source libraries |  | Open-source software | Licence disclosure heading. |
| 06 title | What is not promised |  | Availability and performance | Hardcoded section metadata. |
| 06 sentence 1 | The site is provided as it is. |  | The website is provided as available and without a guarantee that every feature will work on every device. | Paragraph 1. |
| 06 sentence 2 | It leans hard on real-time graphics and it is honest about that: on an older machine, a constrained browser or a poor connection, parts of it may run slowly or not at all. |  | The full experience uses real-time 3D graphics, so it may load slowly, run poorly, or fail on older devices, constrained browsers, or slow connections. | Paragraph 1. |
| 06 sentence 3 | A text version of the same content is available for exactly that case. |  | The `/lite` page provides the same core content without the 3D download. | Paragraph 1. |
| 07 title | Limits |  | Limits of liability | Hardcoded section metadata. |
| 08 title | Changes, and which law applies |  | Changes and governing law | Hardcoded section metadata. |
| Closing title | Anything unclear here, ask. |  | Questions about these terms | `TERMS_DOCUMENT` |
| Closing lead | These are meant to be read, not clicked past. [legal@voidix.tech - confirm this mailbox exists] |  | Contact [replace with the confirmed legal mailbox] with questions about these terms. | `TERMS_DOCUMENT` with placeholder. |
