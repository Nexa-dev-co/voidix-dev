# Deferred Website Content Expansion

Source: `C:\Users\Seifm\Downloads\Voidix content.pdf`

The PDF contains content that does not fit the website and CMS structures currently in production. This file preserves that material for later implementation planning. None of the sections below is part of the current content pass.

## Why This Content Is Deferred

The homepage is one pinned ScrollTrigger. Its four service vessels are structural: model assignment, placement, tuning, and animation are joined by array position. The CMS therefore edits exactly four service records and cannot add, remove, or reorder them safely.

The PDF describes eight distinct offerings and several additional homepage narratives. Adding them without changing the experience would either overload the four vessels or place ordinary page sections beside a homepage that is deliberately built as one pinned journey.

## Standalone Service Categories

The current pass groups the PDF into four existing service vessels. A future service architecture should allow these offerings to exist independently:

1. Custom Websites
2. Custom Web Applications
3. CRM Development
4. Mobile App Development
5. SaaS Development
6. AI Software and AI Tools
7. Business Automation
8. Software Integrations

Each standalone service needs fields for:

- Name
- Short positioning statement
- Description
- Use cases or built-for list
- Capabilities
- Related discipline
- Primary call to action
- SEO title and description when the service has its own route

## Homepage Narrative Blocks

### One Technology Partner Multiple Systems

Purpose: explain that the website, CRM, applications, internal systems, automation, and integrations are designed as one connected technology layer.

Required content:

- Introductory statement
- Websites
- Web applications
- CRM systems
- Mobile applications
- SaaS products
- AI capabilities
- Automation
- Integrations

### From Idea to Working Software

Purpose: show the complete delivery process on the homepage rather than only on the About page.

Steps:

1. Discover
2. Architect
3. Design
4. Build
5. Launch
6. Evolve

The existing About page can already hold these six phases. A homepage version needs its own scene treatment, scroll timing, reduced-motion behavior, and CMS placement decision.

### Built for Businesses With Real Problems to Solve

Use cases:

- Replace manual processes
- Replace outdated software
- Launch a new product
- Connect existing systems
- Add AI to the business
- Build a competitive digital product

### Why Businesses Choose Custom Software

Core message:

> Your workflow is different. Your software should be too.

Supporting content should explain when off-the-shelf tools are suitable and when specialized processes, complex data, unique customer experiences, or connected systems justify custom software.

### From One Website to an Entire Digital Ecosystem

Progression:

1. Start with a website
2. Add a customer portal
3. Connect a CRM
4. Add a mobile application
5. Automate workflows
6. Introduce AI

Core message: build the foundation so the technology can evolve with the business without rebuilding everything at each stage.

## CMS Work Required Later

- Replace the positional four-service contract with stable service identifiers.
- Move vessel assignment and tuning behind those stable identifiers before services can be reordered.
- Decide whether all eight offerings appear in the cinematic homepage, on dedicated service routes, or in both places.
- Add CMS models for the new homepage narrative blocks if they remain homepage content.
- Extend the published payload and mirror its types in `voidix-dev/lib/cms/publishedContent.ts`.
- Add resolvers and fallbacks for every new payload key.
- Mirror the new content in `/lite` so the text-only route remains complete.
- Add crawlable HTML, canonical metadata, sitemap entries, and structured data for any dedicated service routes.
- Preserve the single pinned homepage architecture; new homepage material must be added as overlays or intentionally moved to document routes.

## Planning Questions

1. Should the eight offerings become eight dedicated service pages, eight homepage stops, or four homepage groups plus eight detail pages?
2. Should the delivery process appear in the chamber walls, as previously proposed, or on a document route?
3. Which narrative blocks belong on the homepage, About page, or future Services page?
4. Which content should be editable independently and which copy should be derived from the service records?
5. How should the service expansion affect the enquiry discipline vocabulary without breaking existing project bindings?

## Out of Scope for This Backlog

The three `VOIDIX_B2B_SEO_GEO_Articles_*.docx` files are intentionally excluded at the user's request.
