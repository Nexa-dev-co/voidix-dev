# Voidix Content Adjustment Workbook

Source note: current content was fetched from `C:\dev\voidix-cms` draft tables on 2026-09-20. The latest published CMS release is v14, published 2026-09-11T11:09:07.511Z, and it matches the fetched draft for the sections below.

Attached document note: `C:\Users\Seifm\Downloads\Voidix_SEO_Website_Content_Master_Document.docx` was treated as a content reference only. Its implementation checklist and SEO action items are not instructions for this task.

Usage note: each row below holds one sentence, one short label, or one list item so content can be replaced precisely.

## Protected Brand Mechanics

| Area | File | Protected behavior | Why it matters |
| --- | --- | --- | --- |
| Loader wordmark | `components/effects/IntroSequence/IntroSequence.tsx` | The loader renders `voidix` as `v` + sun-as-`o` + `idix`. | Do not add a normal `o` here when editing content. The missing `o` is intentional because the sun occupies that letter. |
| Hero headline | `components/sections/Hero/Hero.tsx` | The hero renders `worlds` as `W` + sun-as-`o` + `rlds`. | Do not add a normal `o` here when editing content. The missing `o` is intentional because the sun occupies that letter. |

## Hardcoded Text Audit

| Area | File | Hardcoded text found | Suggestions | Notes |
| --- | --- | --- | --- | --- |
| Hero | `components/sections/Hero/Hero.tsx` | `we build worlds` | Custom software for web, mobile, business systems, and AI | Screen-reader H1, not CMS-owned. |
| Hero | `components/sections/Hero/Hero.tsx` | `we build` | Keep as the visible brand headline; the direct tagline below it should explain the offer. | Visible split headline. |
| Hero | `components/sections/Hero/Hero.tsx` | `W` / `rlds` | Keep as is; this is the protected sun-as-`o` composition. | Protected sun-as-`o` composition. |
| Hero | `components/sections/Hero/Hero.tsx` | `software with its own gravity` | Custom websites, apps, business systems & AI | Hero tagline, hardcoded in JSX. |
| Loader | `components/effects/IntroSequence/IntroSequence.tsx` | `voidix™` | Keep as is. | Loader chrome label. |
| Loader | `components/effects/IntroSequence/IntroSequence.tsx` | `v` / `idix` | Keep as is; this is the protected sun-as-`o` wordmark. | Protected sun-as-`o` wordmark composition. |
| Services | `components/sections/ServicesDeck/ServicesDeck.tsx` | `The Fleet` | Services | Section eyebrow, not CMS-owned. |
| Services | `components/sections/ServicesDeck/ServicesDeck.tsx` | `One craft at a time.` | Custom software, | Section headline sentence. |
| Services | `components/sections/ServicesDeck/ServicesDeck.tsx` | `Bring it online.` | built around your business. | Section headline sentence. |
| Services | `components/sections/ServicesDeck/ServicesDeck.tsx` | `Details` | View service details | Mobile drawer button. |
| Services | `components/sections/ServicesDeck/ServicesDeck.tsx` | `Start a build` / `Start this build` | Start a project / Discuss this service | CTA labels around CMS service content. |
| Works | `components/sections/WorksField/WorksField.tsx` | `Selected Work` | Selected work | Section eyebrow, not CMS-owned. |
| Works | `components/sections/WorksField/worksProjects.ts` | `One field.` | Built for real operations. | Section headline second sentence. Count sentence is generated from project count. |
| Works | `components/sections/WorksField/WorksField.tsx` | `Details` | View project details | Mobile drawer button. |
| Works | `components/sections/WorksField/WorksField.tsx` | `Start a build` / `Start one like this` | Start a project / Discuss a similar project | CTA labels around CMS project content. |
| FAQ | `components/sections/Chamber/FaqHologram/FaqHologram.tsx` | `Frequencies` | Frequently asked questions | FAQ list eyebrow. |
| FAQ | `components/sections/Chamber/FaqHologram/FaqHologram.tsx` | `all questions` | All questions | Back button label. |
| FAQ | `components/sections/Chamber/FaqHologram/FaqHologram.tsx` | `Ask us anything` | Ask a question | FAQ CTA and enquiry panel title. |
| FAQ | `components/sections/Chamber/FaqHologram/FaqHologram.tsx` | `Your question` | What would you like to know? | FAQ enquiry field label. |
| FAQ | `components/sections/Chamber/FaqHologram/FaqHologram.tsx` | `Send the question` | Send question | FAQ enquiry submit label. |
| Contact | `components/sections/Contact/ContactSection.tsx` | `04 - Start a project` | 04 - Start a project | Section eyebrow and compact drawer eyebrow. |
| Contact | `components/sections/Contact/ContactSection.tsx` | `Start a project` | Tell us what you need | Compact form button label. |
| Contact | `components/sections/Contact/ContactSection.tsx` | `Travel in time` | Return to the beginning | Loop button label. |
| Contact | `components/sections/Contact/contactContent.ts` | `Black hole model:` / `Black Hole` / `NestaEric` / `CC BY 4.0` | Keep as is; verify the attribution against the model license before launch. | Attribution is hardcoded because it is legal/model metadata, not marketing copy. |
| Navigation | `components/layout/Navbar/Navbar.tsx` | `Start Project` | Start a project | Navbar CTA label. |
| Careers | `components/pages/Careers/RoleRow.tsx` | `What you'd own` | What you would own | Role detail column label. |
| Careers | `components/pages/Careers/RoleRow.tsx` | `What we need to see` | What we need to see | Role detail column label. |
| Careers | `components/pages/Careers/RoleRow.tsx` | `Nice, genuinely not required` | Helpful, not required | Role detail column label. |
| Careers | `components/pages/Careers/RoleRow.tsx` | `Apply for this role` | Apply for this role | Role CTA label. |
| Careers | `components/pages/Careers/CareersPage.tsx` | `Write to us` | Send an open application | Open application CTA label. |
| Application form | `components/ui/EnquiryForm/EnquiryForm.tsx` | `About` | Project or role | Prefill summary label. |
| Application form | `components/ui/EnquiryForm/EnquiryForm.tsx` | `Or a CV - one PDF, up to 5 MB` | Or upload a CV as one PDF up to 5 MB | Application upload label. |
| Application form | `components/ui/EnquiryForm/EnquiryForm.tsx` | `Drop a PDF here` | Drop your CV here | Upload dropzone lead. |
| Application form | `components/ui/EnquiryForm/EnquiryForm.tsx` | `or choose a file` | or choose a PDF | Upload dropzone hint. |
| Consent | `components/ui/ConsentBar/ConsentBar.tsx` | `We'd like to recognise you if you come back.` | Can we recognize a return visit? | Consent banner title. |
| Consent | `components/ui/ConsentBar/ConsentBar.tsx` | `Anonymous counts happen either way and never identify anyone.` | We collect anonymous usage counts either way, and they cannot identify you or connect separate visits. | Consent banner sentence. |
| Consent | `components/ui/ConsentBar/ConsentBar.tsx` | `Saying yes adds one thing: a random id stored on this device, so a second visit is not read as a stranger.` | If you agree, we store a random ID on this device and record detailed cursor paths so we can recognize a return visit and study how the experience is used. | Consent banner sentence. |
| Consent | `components/ui/ConsentBar/ConsentBar.tsx` | `What we collect` / `No thanks` / `Allow cookies` | Read the privacy details / No, thanks / Allow return-visit tracking | Consent link and buttons. |
| Loader | `components/effects/IntroSequence/SkipToLite/SkipToLite.tsx` | `Ten megabytes still to come.` | About 10 MB remains. | Lite fallback prompt copy. |
| Loader | `components/effects/IntroSequence/MotionPrompt/MotionPrompt.tsx` | `Reloads the page` | Reloads this page | Motion prompt option note. |
| CMS fallback content | `components/sections/ServicesDeck/deckServices.ts`, `components/sections/WorksField/worksProjects.ts`, `components/sections/Chamber/faqEntries.ts`, `components/sections/Contact/contactContent.ts`, `components/pages/About/aboutContent.ts`, `components/pages/Careers/careersContent.ts`, `components/ui/EnquiryForm/enquiryFormContent.ts`, `lib/enquirySubjects.ts` | Fallback content arrays and defaults. | Update each fallback whenever the corresponding approved CMS copy changes. | These are hardcoded but intentionally act as fallbacks when the CMS is unconfigured, unreachable, or has no usable release. |
| Legal pages | `components/pages/Legal/privacyContent.ts`, `components/pages/Legal/termsContent.ts` | Legal page copy. | Keep hardcoded for now and apply the approved recommendations from the supporting-pages workbook once the missing legal facts are confirmed. | Not represented in the CMS payload found during this pass. |

## Homepage SEO Reference

| Field | Current | New | Suggestions | Source/Notes |
| --- | --- | --- | --- | --- |
| SEO ownership | The CMS payload does not currently own homepage SEO title, meta description, schema, sitemap, or search-console copy. |  | No change in this task; keep this as a documented system gap. | Hardcoded/system gap from current CMS payload shape. |
| SEO title |  |  | Custom Software Development and AI Solutions \| Voidix | DOCX: `Custom Software Development & AI Solutions \| Voidix` |
| Meta description |  |  | Voidix designs and builds custom websites, web applications, SaaS platforms, mobile apps, CRM systems, integrations, and practical AI for businesses across the United States. | DOCX: `Voidix builds custom software, AI automation tools, CRM systems, websites, and mobile applications that help businesses improve operations and grow.` |
| Main message |  |  | We design and build custom software for companies launching something new or upgrading the systems they already rely on. | DOCX: `Transform your business with intelligent digital solutions.` |
| Key section |  |  | Software built around how your business works | DOCX: `Technology solutions built around your business` |
| Key section |  |  | Custom software development | DOCX: `Custom software development` |
| Key section |  |  | AI products and automation | DOCX: `AI automation solutions` |
| Key section |  |  | CRM and internal systems | DOCX: `CRM systems` |
| Key section |  |  | Websites and web applications | DOCX: `Web experiences` |
| Key section |  |  | Mobile applications | DOCX: `Mobile systems` |
| Key section |  |  | Enterprise and SaaS platforms | DOCX: `Enterprise platforms` |
| Key section |  |  | Frequently asked questions | DOCX: `Frequently Asked Questions` |

## Services Section

### Web Experiences

| Field | Current | New | Suggestions | Source/Notes |
| --- | --- | --- | --- | --- |
| Name | Web Experiences |  | Websites and Web Applications | CMS |
| Eyebrow | Interfaces with escape velocity |  | Custom websites, platforms, and SaaS products | CMS; DOCX repeats this with a period. |
| Description sentence 1 | Bespoke platforms engineered from the metal up - no templates, no compromise. |  | We design and build custom websites, web applications, SaaS products, e-commerce platforms, and customer portals around your business. | CMS |
| Description sentence 2 | Every interaction is hand-tuned until the product moves like it has its own momentum. |  | Each experience is responsive, accessible, fast, and designed to turn attention into action without a template doing the thinking. | CMS |
| Capability | Next.js |  | React and Next.js | CMS |
| Capability | WebGL / GLSL |  | WebGL and GLSL | CMS |
| Capability | Realtime |  | APIs and real-time data | CMS |
| Capability | Design Systems |  | Design systems | CMS |
| Discipline | web |  | Keep `web`; it is a structural CMS key. | CMS key |
| DOCX body sentence 1 |  |  | Defer to the later Services, Focus, and Solutions expansion; do not add a new field now. | `Custom web experiences engineered to turn attention into action.` |
| DOCX body sentence 2 |  |  | Defer to the later Services, Focus, and Solutions expansion; the recommended CMS description above already covers this message. | `Voidix designs and develops high-performance websites and web applications for businesses that need more than a template.` |
| DOCX label style |  |  | Defer; this label belongs to the later section expansion. | `Services` |
| DOCX item |  |  | Defer as a later service-list item: Custom business websites | Custom business websites |
| DOCX item |  |  | Defer as a later service-list item: Web applications | Web applications |
| DOCX item |  |  | Defer as a later service-list item: E-commerce platforms | E-commerce platforms |
| DOCX item |  |  | Defer as a later service-list item: SaaS products | SaaS products |
| DOCX item |  |  | Defer as a later service-list item: Customer portals | Customer portals |
| DOCX item |  |  | Defer as a later service-list item: Interactive digital experiences | Interactive digital experiences |
| DOCX technology |  |  | Defer to the later technology list: Next.js | Next.js |
| DOCX technology |  |  | Defer to the later technology list: React | React |
| DOCX technology |  |  | Defer to the later technology list: TypeScript | TypeScript |
| DOCX technology |  |  | Defer to the later technology list: APIs and integrations | APIs |
| DOCX technology |  |  | Defer to the later technology list: Design systems | Design Systems |

### Mobile Systems

| Field | Current | New | Suggestions | Source/Notes |
| --- | --- | --- | --- | --- |
| Name | Mobile Systems |  | Mobile Applications | CMS |
| Eyebrow | Native, in every dimension |  | Custom iOS and Android apps | CMS |
| Description sentence 1 | Apps that feel like an extension of the device, not a website in a frame. |  | We build mobile applications for customers, employees, and connected products, from the first release through long-term improvement. | CMS |
| Description sentence 2 | Sixty frames a second, offline-first, and tactile in the hand. |  | Each app is designed for the device, with responsive performance, offline support, useful motion, and haptics where they improve the experience. | CMS |
| Capability | iOS / Android |  | iOS and Android | CMS |
| Capability | Offline-first |  | Offline support | CMS |
| Capability | Motion |  | Interface motion | CMS |
| Capability | Haptics |  | Haptics | CMS |
| Discipline | mobile |  | Keep `mobile`; it is a structural CMS key. | CMS key |
| DOCX headline |  |  | Defer to the later Services, Focus, and Solutions expansion; do not add a new field now. | `Digital products that move with your users.` |
| DOCX body sentence |  |  | Defer to the later expansion; the recommended CMS description above carries the direct explanation now. | `Voidix designs and develops custom mobile applications that transform ideas into powerful digital products.` |
| DOCX label style |  |  | Defer; this label belongs to the later section expansion. | `Services` |
| DOCX item |  |  | Defer as a later service-list item: Customer mobile applications | Customer mobile applications |
| DOCX item |  |  | Defer as a later service-list item: Business mobile applications | Business applications |
| DOCX item |  |  | Defer as a later service-list item: Mobile tools for employees | Internal tools |
| DOCX item |  |  | Defer as a later service-list item: Connected mobile systems | Connected mobile systems |
| DOCX focus item |  |  | Defer to the later focus list: Performance | Performance |
| DOCX focus item |  |  | Defer to the later focus list: Usability | Usability |
| DOCX focus item |  |  | Defer to the later focus list: Scalability | Scalability |
| DOCX focus item |  |  | Defer to the later focus list: Business goals | Business goals |

### Enterprise Platforms

| Field | Current | New | Suggestions | Source/Notes |
| --- | --- | --- | --- | --- |
| Name | Enterprise Platforms |  | CRM and Business Systems | CMS |
| Eyebrow | Gravity for your pipeline |  | CRM, workflows, portals, and internal tools | CMS |
| Description sentence 1 | Operational cores that pull every signal into one orbit. |  | We build custom CRM systems, business management platforms, internal tools, customer portals, and integrations that connect operations in one place. | CMS |
| Description sentence 2 | We model the way your business actually works, then make the software disappear into the workflow. |  | The software follows how your company works, automates repetitive steps, controls access, and makes reporting easier. | CMS |
| Capability | Workflow Engines |  | Workflow automation | CMS |
| Capability | Integrations |  | System integrations | CMS |
| Capability | Roles & Access |  | Roles and access | CMS |
| Capability | Reporting |  | Reporting and dashboards | CMS |
| Discipline | enterprise |  | Keep `enterprise`; it is a structural CMS key. | CMS key |
| DOCX headline |  |  | Defer to the later Services, Focus, and Solutions expansion; do not add a new field now. | `Digital platforms built to power modern businesses.` |
| DOCX body sentence |  |  | Defer to the later expansion; the recommended CMS description above explains the offer directly now. | `Voidix develops enterprise software platforms that connect people, processes, and data.` |
| DOCX label style |  |  | Defer; use Solutions when the later structure is added. | `Solutions` |
| DOCX item |  |  | Defer as a later solution-list item: Business management platforms | Business management platforms |
| DOCX item |  |  | Defer as a later solution-list item: SaaS platforms | SaaS platforms |
| DOCX item |  |  | Defer as a later solution-list item: Customer portals | Customer portals |
| DOCX item |  |  | Defer as a later solution-list item: Enterprise integrations | Enterprise integrations |
| DOCX item |  |  | Defer as a later solution-list item: Automation platforms | Automation platforms |
| DOCX focus item |  |  | Defer to the later focus list: Scalability | Scalability |
| DOCX focus item |  |  | Defer to the later focus list: Security | Security |
| DOCX focus item |  |  | Defer to the later focus list: Automation | Automation |
| DOCX focus item |  |  | Defer to the later focus list: Digital infrastructure | Digital infrastructure |

### Artificial Intelligence

| Field | Current | New | Suggestions | Source/Notes |
| --- | --- | --- | --- | --- |
| Name | Artificial Intelligence |  | Artificial Intelligence | CMS |
| Eyebrow | Intelligence in orbit |  | Practical AI built into real work | CMS |
| Description sentence 1 | Models wired into real products, not demos. |  | We build AI agents, workflow automation, retrieval systems, and custom AI features connected to your data and existing tools. | CMS |
| Description sentence 2 | Retrieval, agents, and inference pipelines designed around your data - useful on day one, smarter every week. |  | Each system is tested on real tasks and measured for usefulness, accuracy, speed, and cost before it reaches users. | CMS |
| Capability | LLM Pipelines |  | AI product pipelines | CMS |
| Capability | RAG |  | Retrieval and RAG | CMS |
| Capability | Agents |  | AI agents | CMS |
| Capability | Evaluation |  | Evaluation and monitoring | CMS |
| Discipline | ai |  | Keep `ai`; it is a structural CMS key. | CMS key |
| DOCX headline |  |  | Defer to the later Services, Focus, and Solutions expansion; do not add a new field now. | `Intelligence engineered into your business.` |
| DOCX body sentence |  |  | Defer to the later expansion; the recommended CMS description above states the practical offer now. | `Voidix creates AI-powered solutions that help businesses automate workflows, improve decisions, and create smarter digital systems.` |
| DOCX label style |  |  | Defer; use AI Services when the later structure is added. | `AI Services` |
| DOCX item |  |  | Defer as a later service-list item: AI agents | AI agents |
| DOCX item |  |  | Defer as a later service-list item: AI workflow automation | AI automation |
| DOCX item |  |  | Defer as a later service-list item: Custom AI applications | Custom AI applications |
| DOCX item |  |  | Defer as a later service-list item: AI integrations | AI integrations |
| DOCX focus sentence |  |  | Defer to the later focus section: Practical AI tied to measurable business work. | `Practical AI solutions connected to real business value.` |

## Works Section

| Project | Field | Current | New | Suggestions | Source/Notes |
| --- | --- | --- | --- | --- | --- |
| Valkyrie | Title | Valkyrie |  | Keep as is. | CMS |
| Valkyrie | Client | Streetwear label |  | Streetwear brand | CMS |
| Valkyrie | Year | 2026 |  | Keep as is. | CMS |
| Valkyrie | Description sentence 1 | A shop floor with the stock room built in. |  | Valkyrie is a custom e-commerce platform for a streetwear brand. | CMS |
| Valkyrie | Description sentence 2 | Stock, pricing, coupons, reviews and the homepage itself are edited in the same console that carries an order from checkout to delivery - paid by card through Stripe, or cash at the door. |  | One dashboard manages inventory, pricing, coupons, reviews, homepage content, and every order from checkout to delivery, with Stripe card payments and cash on delivery. | CMS |
| Valkyrie | Tag | Next.js |  | Keep as is. | CMS |
| Valkyrie | Tag | TypeScript |  | Keep as is. | CMS |
| Valkyrie | Tag | tRPC |  | Keep as is. | CMS |
| Valkyrie | Tag | Drizzle ORM |  | Keep as is. | CMS |
| Valkyrie | Tag | Stripe |  | Keep as is. | CMS |
| Valkyrie | Discipline | web |  | Keep `web`; it is a structural CMS key. | CMS key |
| Valkyrie | Live URL | https://www.valkyrie-eg.com/ |  | Keep as is. | CMS |
| Einherji | Title | Einherji |  | Keep as is. | CMS |
| Einherji | Client | Prospecting platform |  | Prospecting platform | CMS |
| Einherji | Year | 2026 |  | Keep as is. | CMS |
| Einherji | Description sentence 1 | Clients to sell to, suppliers to buy from, roles to apply for - three hunts, one pipeline. |  | Einherji is a prospecting platform for finding potential clients, suppliers, and job opportunities in one workflow. | CMS |
| Einherji | Description sentence 2 | Twenty-three sources feed a single queue, and every contact arrives with a message drafted in that hunt's own voice. |  | It gathers opportunities from 23 sources into one queue and drafts an outreach message for each contact based on the type of search. | CMS |
| Einherji | Tag | Next.js |  | Keep as is. | CMS |
| Einherji | Tag | tRPC |  | Keep as is. | CMS |
| Einherji | Tag | LLM Pipelines |  | LLM pipelines | CMS |
| Einherji | Tag | Web Scraping |  | Web scraping | CMS |
| Einherji | Tag | Cron Jobs |  | Scheduled jobs | CMS |
| Einherji | Discipline | enterprise |  | Keep `enterprise`; it is a structural CMS key. | CMS key |
| Einherji | Live URL |  |  | Keep empty until a public URL exists. | CMS value is null. |
| Kemcon | Title | Kemcon |  | Keep as is. | CMS |
| Kemcon | Client | furniture factory |  | Furniture manufacturer | CMS |
| Kemcon | Year | 2026 |  | Keep as is. | CMS |
| Kemcon | Description sentence | A full eco-system for Kemcon company that helps destibute leads through out the website and a full crm for managing the day to day actions also an a automated email to whatsapp integeration in the factory. |  | Kemcon is a custom website and CRM system for a furniture manufacturer, routing website inquiries into day-to-day lead management and connecting email with WhatsApp workflows inside the factory. | CMS |
| Kemcon | Tag | Next.js |  | Keep as is. | CMS |
| Kemcon | Tag | Neon DB |  | Neon | CMS |
| Kemcon | Tag | Prisma |  | Keep as is. | CMS |
| Kemcon | Tag | Zustand |  | Keep as is. | CMS |
| Kemcon | Tag | Framer motion |  | Framer Motion | CMS |
| Kemcon | Tag | Openai API |  | OpenAI API | CMS |
| Kemcon | Discipline | enterprise |  | Keep `enterprise`; it is a structural CMS key. | CMS key |
| Kemcon | Live URL | https://www.kemcon.site/ |  | Keep as is. | CMS |
| Dar El-Kola | Title | Dar El-Kola |  | Keep as is. | CMS |
| Dar El-Kola | Client | Nephrology Clinic |  | Nephrology clinic | CMS |
| Dar El-Kola | Year | 2025 |  | Keep as is. | CMS |
| Dar El-Kola | Description sentence | A full managment system for the patients, sessions, medications and invistigations for each indipendent appointment. |  | Dar El-Kola is a clinic management system that organizes patients, treatment sessions, medications, and investigations around each appointment. | CMS |
| Dar El-Kola | Tag | Next.js |  | Keep as is. | CMS |
| Dar El-Kola | Tag | Neon DB |  | Neon | CMS |
| Dar El-Kola | Tag | Prisma |  | Keep as is. | CMS |
| Dar El-Kola | Tag | Zustand |  | Keep as is. | CMS |
| Dar El-Kola | Tag | GSAP |  | Keep as is. | CMS |
| Dar El-Kola | Tag | WhatsApp API |  | Keep as is. | CMS |
| Dar El-Kola | Discipline | enterprise |  | Keep `enterprise`; it is a structural CMS key. | CMS key |
| Dar El-Kola | Live URL |  |  | Keep empty until a public URL exists. | CMS value is null. |

## FAQ Section

| Field | Current | New | Suggestions | Source/Notes |
| --- | --- | --- | --- | --- |
| Question 01 | What do you actually build? |  | What does Voidix build? | CMS |
| Answer 01 sentence 1 | Software with weight to it. |  | We design and build custom websites, web applications, SaaS platforms, mobile apps, CRM and internal systems, integrations, digital product experiences, and practical AI. | CMS |
| Answer 01 sentence 2 | Trading surfaces, clinical records, storefronts that behave like film, retrieval systems that answer from live data - the kind of product a company runs on rather than demos once. |  | We work with new companies building their first product and established businesses replacing or improving the systems they already use. | CMS |
| Answer 01 sentence 3 | The site you are standing in is the honest answer. |  | The full Voidix website is also a working example of the visual design and frontend engineering we can deliver. | CMS |
| Answer 01 sentence 4 | Every scene here is the same stack we ship to clients: WebGL, custom shaders, scroll choreography that survives a fast flick on a cheap laptop. |  | Its WebGL scenes, shaders, 3D models, responsive layouts, and scroll choreography were built as product code, not added as a theme. | CMS |
| Question 02 | How long does a build take? |  | How long does a project take? | CMS |
| Answer 02 sentence 1 | A focused product surface takes six to ten weeks. |  | A focused website, application, or product surface usually takes 6-10 weeks. | CMS |
| Answer 02 sentence 2 | A platform - many surfaces, real data, real users - runs three to six months. |  | A larger platform with multiple workflows, integrations, and user roles usually takes 3-6 months and may take longer when the scope requires it. | CMS |
| Answer 02 sentence 3 | We do not pad that. |  | We define the schedule around the real scope instead of forcing every project into the same calendar. | CMS |
| Answer 02 sentence 4 | The first fortnight is spent proving the hardest part works, so the estimate you get in week three is one we can actually hold. |  | When a project has meaningful technical risk, the first two weeks produce a working proof so the estimate rests on evidence. | CMS |
| Question 03 | What does it cost? |  | How much does a project cost? | CMS |
| Answer 03 sentence 1 | Engagements start around the price of one senior hire for the same period, and scale with the surface area of the thing being built. |  | Cost depends on the scope, technical risk, integrations, content, and the amount of custom design or 3D work involved. | CMS |
| Answer 03 sentence 2 | You get a fixed scope and a fixed number, or a rate and an honest burn-down. |  | We can quote a fixed scope and price or work from an agreed rate with a visible budget and delivery plan. | CMS |
| Answer 03 sentence 3 | What you never get is a change-request desk that bills you for the ambiguity in your own brief. |  | Before work starts, you will see what is included, what is not, and how a change would affect the price or schedule. No mystery invoice needs its own reveal animation. | CMS |
| Question 04 | Do you work alongside an in-house team? |  | Can you work with our in-house team? | CMS |
| Answer 04 sentence 1 | Often. |  | Yes. | CMS |
| Answer 04 sentence 2 | We come in on the parts nobody in-house has time to invent - the render pipeline, the interaction model, the performance budget - and leave behind code your team can actually read. |  | We can own a complete product or take responsibility for a specific area such as product design, frontend engineering, a render pipeline, an integration, or a performance problem. | CMS |
| Answer 04 sentence 3 | Handover is a deliverable, not a favour. |  | We work in a way your team can inspect, review, and maintain. | CMS |
| Answer 04 sentence 4 | Documented, commented, and walked through until someone on your side can defend every decision in it. |  | The final handover includes readable code, documentation, and a walkthrough of the decisions that matter. | CMS |
| Question 05 | What happens after launch? |  | What happens after launch? | CMS |
| Answer 05 sentence 1 | We stay for a stabilisation window - real traffic finds things no staging environment will - and then hand you the keys. |  | We stay through a stabilization period because real users and live traffic find issues that staging cannot. | CMS |
| Answer 05 sentence 2 | If you want us on retainer after that, the door is open. |  | After that, we can continue improving and supporting the product or complete the handover to your team. | CMS |
| Answer 05 sentence 3 | If you never call again because it simply works, that is the better outcome and we will take it. |  | If the product keeps working and you do not need us, the handover did its job. | CMS |
| Question 06 | Will it run on a phone? |  | Will the product work well on phones? | CMS |
| Answer 06 sentence 1 | Yes, and not as a stripped-down apology. |  | Yes. Responsive behavior and mobile performance are part of the project, not a smaller product added at the end. | CMS |
| Answer 06 sentence 2 | Scenes reframe rather than stretch, the renderer measures its own frame times and trades resolution for smoothness before you ever feel a stutter, and heavy assets ship at the tier the device has earned. |  | A standard interface can target 60 frames per second; a 3D-heavy experience gets a performance target that reflects its visual complexity and the devices it must support. | CMS |
| Answer 06 sentence 3 | The rule is simple: if it cannot hold sixty frames on hardware people actually own, it is not finished. |  | This website targets a stable 30 frames per second because it renders several detailed 3D scenes, while adapting resolution and effects to the device. | CMS |
| Question 07 | How do we start? |  | How do we start a project? | CMS |
| Answer 07 sentence 1 | Tell us what the thing is for and what breaks today. |  | Tell us what you want to build or improve, who will use it, and what is not working today. | CMS |
| Answer 07 sentence 2 | Not a spec - a problem. |  | You do not need a finished specification. A clear problem is enough to begin. | CMS |
| Answer 07 sentence 3 | We come back inside a week with a shape for it: what we would build, what we would refuse to build, and what it takes. |  | We reply within five business days with the questions, risks, and next step needed to shape the project. | CMS |
| Answer 07 sentence 4 | If the shape is wrong, you have lost a week and nothing else. |  | If we are not the right fit, we will say that plainly before either side spends more time. | CMS |

## Contact Section

| Field | Current | New | Suggestions | Source/Notes |
| --- | --- | --- | --- | --- |
| Title | Tell us what you are building. |  | Tell us what you need to build or improve. | CMS |
| Lead sentence 1 | A paragraph is enough - what it is, who it is for, and what has to be true on the day it ships. |  | A short paragraph is enough: what the product or system needs to do, who will use it, and what must improve when it launches. | CMS |
| Lead sentence 2 | You will get an answer from the people who would build it, not a sales desk. |  | We will reply within five business days, and the response will come from the people responsible for scoping and building the work. | CMS |
| Brief label | What you are building |  | What do you need to build or improve? | CMS |
| Submit label | Send it |  | Send project details | CMS |

## Footer Section

| Field | Current | New | Suggestions | Source/Notes |
| --- | --- | --- | --- | --- |
| Tagline | Software with its own gravity |  | Custom software with its own gravity | CMS |
| Sign off sentence 1 | Voidix - a software studio. |  | Voidix is a custom software studio serving companies across the United States. | CMS |
| Sign off sentence 2 | Built with its own gravity. |  | Websites, apps, business systems, and practical AI, designed and built with care. | CMS |
| Studio link | About |  | About Voidix | `/about` |
| Studio link | Careers |  | Careers | `/careers` |
| Direct link | info@voidix.tech |  | Verified public inbox. | `mailto:info@voidix.tech` |
| Elsewhere link | X |  | Keep temporarily; verify the account before launch. | `https://x.com/voidixstudio` |
| Elsewhere link | LinkedIn |  | Verified studio profile. | `https://www.linkedin.com/company/voidix-tech` |
| Elsewhere link | GitHub |  | Keep temporarily; verify the account before launch. | `https://github.com/voidixstudio` |
| Legal link | Privacy |  | Privacy | `/privacy` |
| Legal link | Terms |  | Terms | `/terms` |

## Enquiry Form And Disciplines

| Field | Current | New | Suggestions | Source/Notes |
| --- | --- | --- | --- | --- |
| Name label | Name |  | Name | CMS |
| Email label | Email |  | Work email | CMS |
| Phone label | Phone |  | Phone number | CMS |
| Sending label | Sending... |  | Sending... | CMS |
| Sent message sentence 1 | Sent. |  | Project details received. | CMS |
| Sent message sentence 2 | You will hear back from a person, either way. |  | We will reply within five business days. | CMS |
| Error message sentence 1 | That did not send. |  | Your message was not sent. | CMS |
| Error message sentence 2 | Try again in a moment. |  | Please try again in a moment or use the confirmed public email once it is available. | CMS |
| Reference subject suffix | - like {project} |  | - similar to {project} | CMS |
| Reference brief prefix | In the orbit of {project}. |  | I am interested in a project similar to {project}. | CMS |
| Discipline label | Web Development |  | Website or Web Application | CMS |
| Discipline seed sentence | We need a web platform that doesn't move like anyone else's. |  | We need a custom website, web application, SaaS product, e-commerce platform, or customer portal. | CMS |
| Discipline seed sentence | Here's where we are so far: |  | Here is what exists today and what needs to change: | CMS |
| Discipline label | Mobile Development |  | Mobile Application | CMS |
| Discipline seed sentence | We need an app that feels native in the hand rather than a website in a frame. |  | We need a custom mobile application for our customers, employees, or connected product. | CMS |
| Discipline seed sentence | Here's where we are so far: |  | Here is what exists today and what needs to change: | CMS |
| Discipline label | Enterprise Platform |  | CRM or Business System | CMS |
| Discipline seed sentence | We need an operational core that pulls our tools into one orbit. |  | We need a CRM, internal tool, business platform, workflow, portal, or integration built around how our company operates. | CMS |
| Discipline seed sentence | Here's where we are so far: |  | Here is what exists today and what needs to change: | CMS |
| Discipline label | Artificial Intelligence |  | AI Product or Automation | CMS |
| Discipline seed sentence | We want intelligence wired into the product itself, not bolted on as a demo. |  | We need an AI product, agent, retrieval system, automation, or integration connected to real business work. | CMS |
| Discipline seed sentence | Here's where we are so far: |  | Here is the task, data, and current process: | CMS |

