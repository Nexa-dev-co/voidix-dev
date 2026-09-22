/**
 * The shape the admin panel publishes — this site's half of the contract.
 *
 * ── ⚠ THIS FILE MIRRORS `voidix-cms/lib/content/contentPayload.ts` AND NOTHING ENFORCES IT ───────
 * Two repositories, one JSON document between them, and no shared package. A field renamed on one
 * side and not the other compiles perfectly and arrives as `undefined` at runtime, which is why
 * every consumer here goes through a resolver that can fall back rather than reading the payload
 * straight into JSX. When you change one side, change this one in the same sitting.
 *
 * ── What the panel does NOT own ─────────────────────────────────────────────────────────────────
 * Everything structural. A service has no `modelPath`, `profile`, `light` or placement; a project
 * has no rock geometry; the document pages' numbered section lists (`ABOUT_SECTIONS`,
 * `CAREERS_SECTIONS`) stay in this repo because each `key` is simultaneously an anchor id and a
 * station on the orbit rail — an editor renaming one would break in-page navigation with nothing
 * to catch it. The panel owns words; this repo owns the machine that says them.
 *
 * Every section is nullable because a release predating that section simply has no key for it, and
 * a fresh database has nothing saved yet. `null` means "not ready" — the site's own copy stands in.
 */

/** A claim, then the thing that backs it up — About's principles and Careers' "what it is like". */
export interface PublishedClaim {
  index: string;
  claim: string;
  backing: string;
}

/** One step of a track. No index — the track draws its own progression. */
export interface PublishedPhase {
  span: string;
  name: string;
  detail: string;
}

export interface PublishedInstrument {
  label: string;
  value: string;
}

export interface PublishedAbout {
  eyebrow: string;
  /** One entry per sentence, never one string with a break in it — see PageMasthead's header. */
  title: string[];
  lead: string;
  premiseParagraphs: string[];
  premiseQuote: string;
  principles: PublishedClaim[];
  buildPhases: PublishedPhase[];
  instruments: PublishedInstrument[];
  instrumentsNote: string;
  stack: string[];
  stackNote: string;
  closingTitle: string;
  closingLead: string;
  careersInvite: string;
}

export interface PublishedCareerRole {
  index: string;
  /**
   * ⚠ The role's identity, and the one field an application must carry back. The panel's
   * `/api/applications` matches on this — a title would break the moment an editor rewrote it, and
   * an index would rebind to whichever role took that position.
   */
  slug: string;
  title: string;
  location: string;
  commitment: string;
  owns: string[];
  needs: string[];
  bonus: string[];
  briefSeed: string;
}

export interface PublishedCareers {
  eyebrow: string;
  title: string[];
  lead: string;
  workingHere: PublishedClaim[];
  /**
   * ⚠ May legitimately be empty, and an empty list must NOT fall back to this repo's placeholder
   * roles. "We have nothing open" is a decision an editor makes, the page has a designed state for
   * it, and resurrecting four invented openings over the top of that decision would put a person
   * through an afternoon of applying for a job that does not exist.
   */
  roles: PublishedCareerRole[];
  rolesEmptyLine: string;
  rolesEmptyInvite: string;
  hiringPhases: PublishedPhase[];
  openApplicationTitle: string;
  openApplicationLead: string;
  openApplicationSubject: string;
  openApplicationSeed: string;
  commitmentLabel: string;
  commitmentOptions: string[];
  applicationBriefLabel: string;
  applicationSubmitLabel: string;
  aboutInvite: string;
}

/** One article in the studio's public field journal. */
export interface PublishedBlogBlock {
  kind: 'PARAGRAPH' | 'HEADING_2' | 'HEADING_3' | 'LIST_ITEM';
  body: string;
}

export interface PublishedBlogPost {
  index: string;
  /** Stable route identity. Editing the title in the panel never rewrites this. */
  slug: string;
  title: string;
  /** The source article's supplied search/browser title. */
  seoTitle: string;
  excerpt: string;
  category: string;
  /** Calendar date in `YYYY-MM-DD` form; no timezone shift is allowed to move it a day. */
  publishedOn: string;
  /** Controlled text blocks. No arbitrary HTML or Markdown crosses the CMS boundary. */
  body: PublishedBlogBlock[];
}

export interface PublishedService {
  index: string;
  name: string;
  eyebrow: string;
  description: string;
  capabilities: string[];
  /** The site's `DisciplineId` — what this craft's CTA enquires about. */
  discipline: string;
}

export interface PublishedProject {
  index: string;
  title: string;
  client: string;
  year: string;
  description: string;
  tags: string[];
  discipline: string;
  /**
   * Where the finished thing lives, or null.
   *
   * ⚠ Read the field below before assuming these two are handled alike. `markSvgUrl` is published
   * but must never reach a browser; this one is an editor-supplied address on somebody else's
   * domain and reaching the browser as a real `<a href>` is the entire point of it. Nothing about
   * `markSource.ts` applies here — there is no dereferencing step and there must not be one.
   *
   * Null is the ordinary case rather than a gap: most work is behind a client's login or under an
   * NDA. The section renders no element at all in that case, so there is no empty state to design.
   */
  liveUrl: string | null;
  /**
   * The project's uploaded mark, as a public storage URL — or null, which is a real state rather
   * than a missing one: the field grows the project's INITIAL instead.
   *
   * ⚠ THIS URL MUST NEVER REACH A BROWSER. `lib/cms/markSource.ts` dereferences it on the server
   * during ISR and the page is handed the SVG source. That is not about the file being sensitive —
   * it is that a `<project-ref>.supabase.co` address in the page advertises where the studio's
   * leads database lives, which is the one thing `panelIntake.ts` proxies intake to avoid. Anything
   * that starts fetching this client-side undoes the reason it is a URL at all.
   */
  markSvgUrl: string | null;
}

export interface PublishedFaqEntry {
  index: string;
  question: string;
  answer: string[];
}

export interface PublishedContact {
  title: string;
  lead: string;
  briefLabel: string;
  submitLabel: string;
}

export interface PublishedFooterLink {
  label: string;
  href: string;
  external: boolean;
}

export interface PublishedFooterGroup {
  title: string;
  links: PublishedFooterLink[];
}

export interface PublishedFooter {
  tagline: string;
  signOff: string;
  groups: PublishedFooterGroup[];
}

export interface PublishedDiscipline {
  key: string;
  label: string;
  briefSeed: string;
}

export interface PublishedEnquiryForm {
  nameLabel: string;
  emailLabel: string;
  phoneLabel: string;
  sendingLabel: string;
  sentMessage: string;
  errorMessage: string;
  /** Both carry a `{project}` placeholder this site substitutes. */
  referenceSubjectSuffix: string;
  referenceBriefPrefix: string;
}

/** One release, whole. The panel never sends a partial one — it snapshots every section at once. */
export interface PublishedContent {
  services: PublishedService[];
  projects: PublishedProject[];
  faq: PublishedFaqEntry[];
  contact: PublishedContact | null;
  footer: PublishedFooter | null;
  about: PublishedAbout | null;
  careers: PublishedCareers | null;
  /** May legitimately be empty: an empty archive must not grow invented articles. */
  blogs: PublishedBlogPost[];
  disciplines: PublishedDiscipline[];
  enquiryForm: PublishedEnquiryForm | null;
}

/** What `GET /api/content` answers with. The version is for logging, not for logic. */
export interface PublishedRelease {
  version: number;
  publishedAt: string;
  payload: PublishedContent;
}
