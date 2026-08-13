# CMS integration + search visibility — plan of record, 2026-08-13

Two jobs that look separate and are not: finishing the panel wiring means editing the exact
components whose markup is costing the site its search visibility. Doing them apart means touching
`ServicesDeck`, `WorksField`, `FaqHologram` and `ContactSection` twice.

Ordering principle: **the contract is settled before any component moves, and nothing that changes a
pixel ships before the things that cannot.**

## Status — ①②③ done, 2026-08-13

**All nine payload keys are now read.** `tsc --noEmit` clean, `npm run build` exit 0, 8/8 pages, and
the rendered DOM is byte-for-byte what it was — verified by grep against `.next/server/app/*.html`,
because with the panel unreachable every resolver must return exactly this repo's own copy, and any
difference at all would mean a resolver was rewriting something it should have passed through.

⚠ **Two things the plan got wrong, both found by building it:**

1. **The provider had to be SITE-WIDE, not the homepage's.** `EnquiryForm` renders on all four
   routes and `PageFooter` on three, so scoping their strings to `/` would have left the document
   routes silently serving fallbacks while the homepage served the panel's. And `/lite` re-presents
   `services` / `projects` / `faq` — they are the site's words, not the homepage's. `HomeContent`
   became `SiteContent`.
2. ⚠ **A Server Component's props are serialised into the HTML, and that is a page-weight cost.**
   Handing every route one whole `SiteContent` shipped the fleet's, the field's and the chamber's
   copy to `/about` and `/careers` as RSC payload — **measured at 11.1 kB, 28 % of `/about`'s entire
   HTML**, rendered on neither. Wrong direction on the two pages best placed to rank. Fixed by
   splitting `SiteSections` (`/` and `/lite`) from the shared vocabulary (everywhere): `/about` went
   40,080 → 32,439 B and `/careers` 46,885 → 39,244 B, **−7.6 kB each**.

⚠ **And one measurement trap worth keeping.** Grepping the built HTML for published copy shows it
present on `/` — *inside a `<script>` tag*, as the RSC payload, not as rendered markup. Strip
`<script>…</script>` before counting or the SEO diagnosis below reads as already fixed when nothing
has changed. The DOM-only numbers are the real ones.

## Status — ④ done, ⑤ part-done, ⑥ part-done, 2026-08-13

**The domain is `voidix.tech`**, confirmed and now in `lib/siteMetadata.ts` as `SITE_URL`
(overridable by `NEXT_PUBLIC_SITE_URL` so a preview deploy does not canonicalise to production).

| | |
|---|---|
| `app/robots.ts` | ✅ ⚠ `/lite` is **not** `Disallow`ed — a crawler that cannot fetch it never reads the `noindex` telling it not to index it, and disallowed-but-linked URLs get indexed anyway, with no description. Allow the fetch; let the tag work. |
| `app/sitemap.ts` | ✅ three routes; `/lite` deliberately absent |
| canonicals | ✅ `/`, `/about`, `/careers` |
| `metadataBase` | ✅ real domain, TODO gone |
| **`<h1>`** | ✅ **the homepage had none and now has one** |
| `Organization` JSON-LD | ✅ no `sameAs` — the handles are still invented |
| `FAQPage` JSON-LD | ✅ **7 questions and 2,198 characters of answer prose**, where the DOM had zero |
| OG image | ❌ still none — every shared link previews blank |

⚠ **A canonical in the ROOT LAYOUT leaks to every route that does not override it.** It was there for
one build and put `<link rel="canonical" href="https://voidix.tech">` on `/lite` — telling crawlers
the text version *is* the homepage while its own `noindex` told them to drop it, which are two
contradictory instructions about one URL. Canonicals belong on **pages**: forgetting one is then a
missing tag rather than a silent claim to be a different page.

⚠ **The `<h1>` is `sr-only`, and that is forced rather than chosen.** An `<h1>` may only contain
PHRASING content, and the hero's mark is a `<p>` and two `<div>`s — one of them `[data-hero-card]`,
the untransformed anchor both `useHeroAnimation` and `HeroSun` measure. Wrapping it is invalid HTML;
restructuring it to be valid means changing the element types the sun's flight aims at. So the real
sentence is carried in an `sr-only` `<h1>` and the visual mark is `aria-hidden`. Not a cloak — the
text is exactly what is on screen, and the star genuinely is the "o".

### Still open

- **⑤b — three of four services and three of four projects are still absent from the DOM.** This is
  the largest remaining indexable-content win and the one item here that needs eyes on a screen: the
  deck's arrival stagger walks `.deck-detail > *` and the block is `key={activeService.index}` so it
  remounts per change. Rendering all four means the stagger must target only the active one
  (`.deck-detail[data-active] > *`) and the CSS must hide the rest. Deferred deliberately — it cannot
  be verified by `tsc`.
- **⑤c — the FAQ answers are still not in the DOM.** ⑥'s `FAQPage` schema covers the search case, so
  the remaining reason to do this is that the schema and the page should agree. Lower priority now.
- **⑥ — `JobPosting` is blocked**, and on the panel rather than here: the payload carries no
  `datePosted`. Do not synthesise one from the release timestamp — a role republished with a typo fix
  would read as freshly posted. Needs a column, and probably `/careers/[slug]` to hang each posting
  on (⑦).
- **An OG image.** Not hard, but it is a design artefact rather than a code change.
- **⑦ — alerting on the fallback path**, still the failure that is invisible by construction.

```
  ①  the record         docs on both sides are stale     ← no code, blocks nothing, misleads everyone
  ②  the spine          one server resolve → one prop    ← the whole homepage wiring rests on it
  ③  the seven keys     services · projects · faq        ← merge-by-index traps live here
                        contact · footer · disciplines
                        enquiryForm
  ───────────────────────── ship + your eyes ─────────────────────────────
  ④  found              sitemap · robots · canonical     ← zero visual risk, unblocks everything
  ⑤  read               the <h1>, and the copy that      ← changes markup, not design
                        is not in the HTML
  ⑥  understood         JSON-LD · JobPosting             ← the CMS pays for itself here
  ───────────────────────── decisions, not defects ───────────────────────
  ⑦  trade-offs         /work/[slug] · /careers/[slug]   ← your call, against the one-pin rule
```

---

## Where this actually stands

Both repositories' documentation says the site is not connected. **It is, for two of nine keys.**

```
   voidix-cms                                     orbix-dev  (feat/cms)
   ──────────                                     ─────────────────────

   draft tables                                   app/about/page.tsx      ✅ reads
        │  publish (append-only)                  app/careers/page.tsx    ✅ reads
        ▼                                         app/page.tsx            ❌ reads nothing
   content_releases ──── GET /api/content ───────► lib/cms/fetchPublishedContent.ts
        │                (x-voidix-secret)             │  ISR: tag + 600s backstop
        │                                              │  never throws → null → local copy
        └──── POST ────► /api/revalidate ──────────────┘
              (bearer)   revalidateTag, fails closed

   inbox ◄──── POST /api/submissions ◄──── /api/enquiry ◄──── EnquiryForm  ✅ live
   applications ◄─ POST /api/applications ◄─ /api/application ◄─┘          ✅ live
```

The read side is built and correct. The write side is built and live. **What is missing is that
seven of the nine payload keys have no consumer**, and all seven are on the homepage.

| payload key | panel writes | site reads | site's own copy |
|---|---|---|---|
| `about` | ✅ | ✅ | `aboutContent.ts` |
| `careers` | ✅ | ✅ | `careersContent.ts` |
| `services` | ✅ | ❌ | `deckServices.ts` |
| `projects` | ✅ | ❌ | `worksProjects.ts` |
| `faq` | ✅ | ❌ | `faqEntries.ts` |
| `contact` | ✅ | ❌ | `contactContent.ts` |
| `footer` | ✅ | ❌ | `CONTACT_FOOTER_GROUPS` |
| `disciplines` | ✅ | ❌ | `lib/enquirySubjects.ts` |
| `enquiryForm` | ✅ | ❌ | constants in `EnquiryForm.tsx` |

---

## ① The record (no code)

Four documents describe a system that no longer exists. Fix them in the first commit, before anyone
re-derives a conclusion from them.

**In `voidix-cms`:**
- `docs/PROJECT.md` §11 — *"The site is not connected"* and the three-step "to connect it" list.
  Steps 1 and 2 are done.
- `docs/PROJECT.md` §11 known gaps — *"A published career role cannot be applied to"*. The site now
  has `/api/application`, and `uploadthing` landed in `package.json` at `305b396`. **Verify the CV
  upload path end to end before deleting this entry** — it is the one claim here I have not
  exercised.
- `README.md` "Connecting the site" — same three steps.
- `README.md` "What this panel deliberately cannot do" — *"the site's forms still block their own
  submit"*. They post.

**In `orbix-dev`:**
- `CLAUDE.md` PART 4 — Contact *"handleSubmit prevents default and posts nowhere"*. It posts.
- `CLAUDE.md` PART 4 — Careers *"DASHBOARD-MANAGED, not yet connected"*. Connected.
- `CLAUDE.md` PART 4 — *"the `docs/` directory is nearly empty"*, still true; this file joins it.

⚠ **And the thing neither side records: the contract has no enforcement.**
`lib/cms/publishedContent.ts` and `voidix-cms/lib/content/contentPayload.ts` are byte-equivalent in
shape today — I compared every field. Nothing keeps them that way. A rename on one side compiles on
both and arrives `undefined` at runtime, and because every consumer falls back rather than throwing,
**the symptom is a section quietly reverting to placeholder copy**, which looks like "we haven't
published yet" rather than like a bug.

Both files carry a warning saying *change one, change the other in the same sitting*. That is the
right instruction and it will hold for a while. Revisit when 9/9 are wired — a shared package is the
obvious answer and the reason it was not done is that two repos with no monorepo tooling is a real
cost for one JSON shape. **Not now.** Note it and move on.

---

## ② The spine — one server resolve, one prop

This is the whole reason the homepage was not wired with `/about` and `/careers`.

**Why those two were easy.** Each is a Server Component that awaits the panel, resolves one object,
and hands it to one client tree:

```tsx
export const revalidate = 600;

export default async function About() {
  const published = await fetchPublishedContent();
  return <AboutPage content={resolveAboutContent(published?.about ?? null)} />;
}
```

`resolveAboutContent` is the pattern to copy exactly: `null` in → the whole `*_FALLBACK` constant
out; a payload in → a field-by-field map. One shape for both sources, so a component can never read
a published field for one thing and a hardcoded one for another.

**Why the homepage is not.** `app/page.tsx` is a Server Component, but everything below it is
`'use client'`, and each content file is imported **at module scope by the leaf that renders it**:

```
  app/page.tsx  (server)
    │
    ├── <Hero/>                'use client'
    │     ├── <ServicesDeck/>  ← imports DECK_SERVICES directly
    │     ├── <WorksField/>    ← imports WORKS_PROJECTS directly
    │     └── <ContactSection/>← imports CONTACT_* directly
    │
    ├── <HeroSun/>
    ├── <IntroSequence/>
    ├── <FaqHologram/>         ← imports FAQ_ENTRIES directly ⚠ SIBLING of Hero, not a child
    ├── <LoopVeil/>
    └── <SectionJumpVeil/>
```

That is a static import graph, not a props graph. And `FaqHologram` is a **sibling** — it lives out
in `page.tsx` because the pin's spacer is transformed and the panel must be `position: fixed` against
the viewport. So one prop threaded through `<Hero/>` does not reach it.

**Two ways to solve it. Take the second.**

*Option A — drill props.* `page.tsx` resolves, passes `content` into `<Hero/>` and separately into
`<FaqHologram/>`; `Hero` forwards slices to its three overlays. Honest, explicit, no new concepts.
Costs a `content` prop on four components and a forwarding layer in `Hero` that exists only to pass
things through — and `Hero.tsx` is already an orchestration file that CLAUDE.md's single-
responsibility rule is watching.

*Option B — one Client Context, written once at the top.* `page.tsx` resolves server-side and renders
a `<HomeContentProvider content={…}>` around its children; each leaf reads the slice it needs.

```
  app/page.tsx (server)
      const published = await fetchPublishedContent();
      const content   = resolveHomeContent(published);   ← ONE resolver, ONE shape
          │
          ▼
      <HomeContentProvider content={content}>            ← 'use client', renders children
          <Hero/> <HeroSun/> <IntroSequence/> <FaqHologram/> …
      </HomeContentProvider>

      ServicesDeck   →  useHomeContent().services      (DeckService[]  — merged)
      WorksField     →  useHomeContent().projects      (WorksProject[] — merged)
      FaqHologram    →  useHomeContent().faq
      ContactSection →  useHomeContent().contact / .footer
      EnquiryForm    →  useHomeContent().enquiryForm / .disciplines
```

**Option B, for one reason that is not convenience:** the sibling problem. `FaqHologram`,
`LoopVeil` and `SectionJumpVeil` are out in `page.tsx` *because of the transformed pin*, and any
future component that needs `position: fixed` will join them there. A context wraps them all
without caring about the tree shape; prop-drilling has to grow a second path for every one of them.

⚠ **The provider is resolved on the SERVER and passed down as a serialised value.** It must not
fetch. `fetchPublishedContent` has no `NEXT_PUBLIC_` secret — imported into a client bundle it does
not leak the key, it silently stops fetching and falls back forever, which is the quieter and more
confusing failure. The provider holds a value; it never goes and gets one.

⚠ **`export const revalidate = 600` goes in `app/page.tsx` as a literal**, for the two reasons
`app/about/page.tsx`'s header already spells out: the segment export is read by static analysis so
an imported constant resolves to `undefined`, and omitting it bakes the route fully static if the
panel happens to be unreachable during the build.

⚠ **The homepage is currently fully static and this makes it ISR.** That is the intended trade and
it is worth naming: the first request after a revalidation pays the panel round trip (8 s timeout,
realistically ~100 ms). It does not affect the loader — the 10 MB of models are static assets on the
CDN and start downloading from the preload tags in `<head>` either way.

---

## ③ The seven keys

Three are pure copy and nearly free. Two carry structure and have traps. Two are string constants
that have to be lifted out of components first.

### The easy three — `faq`, `contact`, `footer`

`FaqEntry`, the contact strings and `ContactFooterGroup` are copy end to end. Write
`resolveFaqEntries`, `resolveContactContent`, `resolveFooterGroups` on the `resolveAboutContent`
pattern and they are done.

⚠ **`footer` feeds two footers** — the contact section's and `PageShell/PageFooter` on the document
routes. The document routes resolve it from their own `fetchPublishedContent` call already in flight;
they must read the *same* resolver, not a second copy. And the panel's own note applies: the contact
footer shares one pinned viewport with a form and a black hole, and `globals.css` has a whole
`@media (max-width: 30em)` block about the ~150 px it once overran by. **A longer label gets checked
on a 360 px phone on the homepage, not on `/about` where there is room to spare.**

⚠ **`external` is derived, not stored.** The panel computes it from the href in `contentPayload`
because a stored flag can disagree with the URL beside it. The site's `ContactFooterLink.external` is
optional; map `published.external` straight onto it and do not re-derive.

### `services` — merge by POSITION, and the position is load-bearing

`DeckService` is copy **and** structure in one object:

```
  DeckService
  ├── index         ┐
  ├── name          │
  ├── eyebrow       ├─ the panel owns these
  ├── description   │
  ├── capabilities  │
  ├── discipline    ┘
  ├── modelPath     ┐
  ├── profile       ├─ this repo owns these, and always will
  ├── light         │  (a vessel needs a .glb, a hull palette, Draco, placement)
  └── modelRotation ┘
```

So resolution is a **merge**, not a replacement:

```ts
DECK_SERVICES.map((service, position) => {
  const publishedService = published?.services[position];
  return publishedService ? { ...service, ...copyFieldsOf(publishedService) } : service;
});
```

⚠ **By position, and only by position.** `deckTuning.ts` line 127 builds its ship list as
`DECK_SERVICES.map(restingShip)` and its `hiddenParts` are *positional* strings — the file says so
at line 18, because the vessels are third-party glbs whose mesh names are inconsistent, absent or
duplicated. Reorder or delete a service and every placement binds to the wrong vessel **silently**.
This is why the panel refuses to add, reorder or delete services at all.

⚠ **Guard the length mismatch explicitly.** If the panel ever publishes a different count than this
repo has models for, the merge must fall back to local copy for the whole list rather than produce a
half-published fleet. A `published.services.length !== DECK_SERVICES.length` check that returns
`DECK_SERVICES` and warns once is the right shape — it is the same "one release, whole" contract the
panel publishes under.

### `projects` — merge by `markId`'s reasoning, but the join is still position

`WorksProject` splits the same way: the panel owns `index`, `title`, `client`, `year`,
`description`, `tags`, `discipline`; this repo owns `markId`.

`markId` is already the safer pattern and its header says why — `prepareMarks` **drops** a mark whose
file fails to load, which by position would silently shift every later project onto its neighbour's
logo. The panel does not publish `markId`, so the merge is still positional, but the consequence of a
count mismatch is milder: a project added in the panel renders with the fallback mark, which the
CMS README already warns reads as "the same body repeated".

⚠ **`WorksField.tsx` hardcodes "Four fires."** in its `<h2>`. The panel warns when the count leaves
four; the heading is still a developer change. Either lift it into `worksProjects.ts` as a constant
or accept it — but do not let the panel imply it can change it.

### `disciplines` — the vocabulary three places share

`lib/enquirySubjects.ts` is a `Record<DisciplineId, Discipline>`; the payload is a
`PublishedDiscipline[]` with `key`/`label`/`briefSeed`. Resolve into the record shape, keyed by
`key`.

⚠ **`key` is not editable in the panel and that is deliberate** — renaming one would silently unbind
every service and project from its CTA. `DisciplineId` is a union type here; a published key outside
it must fall back rather than widen the type. Validate on resolve.

⚠ **The `briefSeed` carries a trailing space** and it is invisible. The seeds are left mid-sentence
for the visitor to finish; the panel's `toPlainLine` trims every string on save, so
`continuationSeed()` in `contentPayload.ts` puts it back at publish time. **Do not trim it again on
this side.**

### `enquiryForm` — lift the constants out first

`SENT_MESSAGE`, `ERROR_MESSAGE` and the field labels are `const` declarations inside
`EnquiryForm.tsx`. They have to become a data file before a resolver can reach them — same move
`contactContent.ts` already represents for its section.

⚠ **`RATE_LIMITED_MESSAGE` is not in the payload** and should stay out of it. It is a response to a
specific status from the intake route, not section copy, and an editor rewriting it into something
reassuring would be rewriting a system message.

⚠ **`referenceSubjectSuffix` and `referenceBriefPrefix` carry a `{project}` placeholder** the site
substitutes. If the panel's copy loses the token, the substitution silently produces a sentence with
a hole in it. Check for the token on resolve and fall back if it is missing.

---

## Search visibility — the diagnosis

**Being CMS-driven does not cost this site anything in search.** The content is fetched server-side
and rendered into HTML through ISR; Googlebot receives complete markup. A CMS only damages search
visibility when content is fetched client-side after hydration, and the architecture here does the
opposite. That question is settled — the answer is no.

**The homepage's markup is a different matter, and it is costing the site now, before the CMS is
finished.**

Client components *are* server-rendered by Next — only the three canvases are `ssr: false`, and the
overlays are `display: flex`, not `display: none`. So the copy that reaches the HTML is exactly the
copy the components choose to render at initial state. That turns out to be about a quarter of it:

```
  what a crawler gets from  /

  ┌─ hero ─────────────────────────────────────────────────────────────┐
  │  "we build"  ·  "W"  ·  [sun]  ·  "rlds"                           │
  │                                                                    │
  │  ⚠ NO <h1> ELEMENT AT ALL — a <div role="heading" aria-level={1}>  │
  │    with aria-label="we build worlds". The DOM text reads           │
  │    "we build W rlds". aria-label is an accessibility affordance,   │
  │    not an indexing signal.                                         │
  └────────────────────────────────────────────────────────────────────┘
  ┌─ services ─────────────────────────────────────────────────────────┐
  │  <h2> "One craft at a time. Bring it online."              ✅       │
  │  4 × name in the carousel strip                            ✅       │
  │  eyebrow + description + capabilities   ← activeService     ⚠ 01 ONLY│
  └────────────────────────────────────────────────────────────────────┘
  ┌─ works ────────────────────────────────────────────────────────────┐
  │  <h2> "Four fires."                                        ✅       │
  │  title · client · year · description · tags ← activeProject ⚠ 01 ONLY│
  └────────────────────────────────────────────────────────────────────┘
  ┌─ faq ──────────────────────────────────────────────────────────────┐
  │  7 × question                                              ✅       │
  │  0 × answer          ← openEntry starts null, and the render is a  │
  │                        TERNARY: the list OR one answer, never both │
  │                      ⚠ ZERO answer prose reaches the HTML          │
  └────────────────────────────────────────────────────────────────────┘
  ┌─ contact ──────────────────────────────────────────────────────────┐
  │  <h2> title · lead · footer groups                         ✅       │
  └────────────────────────────────────────────────────────────────────┘
```

The FAQ is the most search-valuable prose on the site — real question-and-answer text, the kind
that earns rich results — and **not one word of an answer is indexable.** Three quarters of the
services and works copy is in the same position.

**And the site-level machinery is absent:**

| | |
|---|---|
| `app/sitemap.ts` | ❌ does not exist |
| `app/robots.ts` | ❌ does not exist |
| canonical URLs | ❌ never declared |
| JSON-LD, any type | ❌ none anywhere |
| OG image | ❌ `openGraph` has title/description/type, **no `images`** — every shared link previews blank |
| `metadataBase` | ⚠ `https://voidix.studio`, carrying a `TODO` saying it is a guess at the post-rebrand domain. **Every relative canonical and OG URL resolves against it.** |

**The irony worth stating plainly:** `/lite` is the only page on this site whose HTML contains all
the services, all the projects and all the FAQ answers — and it is the one page marked
`robots: { index: false }`. That call is *correct*; two URLs serving the same copy is the textbook
duplicate-content case and the comment defending it is right. But it means the complete text exists,
in this repo, deliberately withheld from search, while the canonical page shows a quarter of it.

**Two more costs, both already in this repo's own notes:** the homepage gates ~10 MB behind the
loader, and page experience is a ranking input; and `layout.tsx` preloads ~2.1 MB of star, Draco and
Basis **on every route** — including `/about` and `/careers`, which never load a model and are the
two pages best positioned to actually rank. `docs/about-careers-plan.md` §1e has that fix.

---

## ④ Found — the machinery that does not exist yet

Zero visual risk. Do it in one commit.

- **`app/robots.ts`** — allow all, point at the sitemap. `/lite` keeps its per-page `noindex`; do
  not also disallow it in robots, or the `noindex` can never be read.
- **`app/sitemap.ts`** — `/`, `/about`, `/careers`. Not `/lite`.
- **`metadataBase`** — ⚠ **this is a decision only you can make.** Confirm the real production
  domain. Everything below inherits it and a wrong host breaks canonicals and link previews
  silently.
- **`alternates: { canonical: … }`** on all four routes.
- **An OG image.** The hero's cream square with the sun is the obvious frame. A static 1200×630 in
  `/public` referenced from `metadata.openGraph.images` is enough; `opengraph-image.tsx` generation
  is not worth it for four routes.

---

## ⑤ Read — the copy that is not in the HTML

Changes markup. Changes no design.

**⑤a — a real `<h1>`.** The hero splits "worlds" around the sun because the sun *is* the "o"; that
is the site's whole opening move and it is not negotiable. What is negotiable is the element:

- make the group an actual `<h1>` rather than `<div role="heading" aria-level={1}>`
- put the missing glyph in as `<span class="sr-only">o</span>` so the DOM text reads
  **"we build worlds"**

This is not cloaking. The visible heading genuinely says "we build worlds" — a graphic stands in for
one letter, and the span is the accessible equivalent, which is exactly what the existing
`aria-label` was already asserting. There is **no `sr-only` utility in `globals.css` yet**; it is a
three-line addition and several other things below will want it.

**⑤b — render the copy that exists.** Services and works both render from `activeService` /
`activeProject`. Rendering all four and letting the existing CSS reveal one is ordinary carousel
behaviour and crawlers handle it. ⚠ **The cost is not zero and must be measured:** the deck's arrival
stagger walks `.deck-detail > *`, and the detail block is `key={activeService.index}` specifically so
it re-mounts and re-reveals on every change. Four sets of children changes what that walk sees. This
one needs your eyes on the animation, not just a typecheck.

**⑤c — the FAQ answers.** The hologram is a **drill-down**, not an accordion: a ternary renders the
list *or* one answer. Making all seven answers exist in the DOM means restructuring that into
something CSS-toggled, and the panel is `aria-hidden={!isOpen}` while sealed for a good reason
already written in the file.

⚠ **Do the JSON-LD first (⑥) and treat this as optional.** `FAQPage` structured data built from
`FAQ_ENTRIES` gets the questions and answers to Google without touching the scene at all, and
Google's requirement that the content be visible on the page is satisfied — a visitor reaches every
answer by clicking a question. If ⑥ lands and the FAQ still under-performs, come back and restructure
the hologram. Not before; the risk-to-reward is wrong in the other order.

---

## ⑥ Understood — JSON-LD, and where the CMS pays for itself

- **`Organization`** in `app/layout.tsx` — name, url, logo, `sameAs` from the footer's socials.
  ⚠ **Blocked on real socials.** `contactContent.ts` says every handle in there is invented. Do not
  publish invented `sameAs` URLs; that is a claim the site cannot back, which is the one rule the
  copy has held everywhere else.
- **`FAQPage`** on `/`, built from the resolved `faq` — see ⑤c.
- **`JobPosting`, one per role.** ⭐ **The highest-leverage item in this document.** It puts the
  studio in Google Jobs, and it falls straight out of a data model that already exists: the panel
  models roles with `slug`, `title`, `location`, `commitment`, `owns`, `needs`, `bonus`. Nothing new
  has to be authored.

  ⚠ `JobPosting` wants `datePosted` and ideally `validThrough`, and **the payload carries neither**.
  That is a panel-side schema addition, not a site-side workaround — do not synthesise a date from
  the release timestamp, because a role republished with a typo fix would look freshly posted.
  ⚠ And it wants a stable URL per posting, which is ⑦.

---

## ⑦ Decisions, not defects

**`/careers/[slug]`.** `JobPosting` really wants one URL per role. The `slug`-as-identity decision
already anticipated this — it exists because the panel files applications against it, precisely
because a title is editable copy. The document-route pattern (`PageShell`) is built and would carry
these with no new CSS. **Recommended, once ⑥ is in.**

**`/work/[slug]`.** Four project pages would be a large search gain and it runs straight at the
one-pin principle. It does not *break* it — `/about`, `/careers` and `/lite` already established
that genuinely-prose routes stay outside the pin rather than inside a second one — but four
case-study pages is a content commitment, and `worksProjects.ts` is explicitly placeholder. **Not
until the projects are real.**

**Alerting on the fallback path.** `fetchPublishedContent` never throws, which is right for uptime
and is a hazard for search: if the panel is unreachable when a page revalidates, the page silently
serves this repo's fallback prose, and a crawler may take a snapshot of copy nobody thinks is live.
Today that is a `console.warn`. It should be something someone actually sees. Low effort, and the
failure it catches is invisible by construction.

---

## Verification — measured 2026-08-13, not inferred

⚠ **The branch did not build when this was written, and the cause was not code.** `uploadthing@^7.7.4`
is in `package.json` (commit `305b396`) and in the lockfile, but had never been installed —
`npm install` had not been run since that commit. `next build` died on
`Module not found: Can't resolve 'uploadthing/server'`. One `npm install` fixes it, and it is the
first thing to do on a fresh checkout of this branch.

After that: `npx tsc --noEmit` clean, `npm run build` exit 0, 8/8 static pages.

⚠ **The build emitted `[cms] could not reach the content panel: fetch failed` four times and
succeeded anyway.** That is the fallback design working exactly as `fetchPublishedContent`'s header
promises — and it is also the precise scenario `app/about/page.tsx`'s header warns about, which is
why its `export const revalidate = 600` is not optional. Both document routes still came out as ISR
rather than baked static, so they will pick up the panel on their first revalidation. **This is the
strongest argument for ⑦'s alerting item:** a build that cannot see the panel looks identical to a
successful one apart from four lines of `console.warn`.

**The HTML diagnosis is now measured** — grepped out of `.next/server/app/*.html`:

```
                                    /            /lite
  ────────────────────────────────  ───────────  ───────────
  <h1> elements                     0    ⚠       1
  hero DOM text                     "we build" · "W" · "rlds"
  service names                     4/4          4/4
  service descriptions              1/4  ⚠       4/4
  project titles                    1/4  ⚠       4/4
     (Aphelion only; Meridian,
      Cinder, Halcyon absent)
  FAQ questions                     7/7          7/7
  FAQ answer paragraphs             0    ⚠⚠      4/4
  robots                            —            noindex, follow
```

**Every prediction in the diagnosis held.** The homepage carries zero `<h1>`, one service
description in four, one project in four, and **not one FAQ answer**. `/lite` carries all of it and
is the page told not to index — the irony in the diagnosis above is real and now measured.

## What I have still not verified

- **The CV upload end to end.** `/api/application` is fully built — server-side `UTApi`, constructed
  per request so it cannot capture a stale token, `ufsUrl` not the deprecated `url`, and every
  failure path returns `undefined` rather than throwing so the applicant gets a real message instead
  of a 500. It reads correct and it compiles. **I did not upload a file.** That needs a real
  `UPLOADTHING_TOKEN` and a live panel.
- **Anything on screen.** No dev server, no browser — per the standing convention that you run the
  app.
