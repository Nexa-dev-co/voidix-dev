# Careers Page Content Workbook

Source note: current Careers copy is CMS-backed through `C:\dev\voidix-cms`; the website fallback lives in `components/pages/Careers/careersContent.ts`. Current CMS release v14 matches the draft fetched on 2026-09-20.

Usage note: each row holds one sentence, one label, or one list item. Fill `New` and `Suggestions` as needed.

## Page Structure

| Field | Current | New | Suggestions | Source/Notes |
| --- | --- | --- | --- | --- |
| Route | `/careers` |  | Keep as is. | Document route, native scroll. |
| Section 01 title | What it is like here |  | How work happens here | Hardcoded structure in `CAREERS_SECTIONS`; not CMS copy. |
| Section 02 title | Open roles |  | Open roles | Hardcoded structure in `CAREERS_SECTIONS`; not CMS copy. |
| Section 03 title | How hiring runs |  | How hiring works | Hardcoded structure in `CAREERS_SECTIONS`; not CMS copy. |
| Section 04 title | Nothing fits? |  | Open applications | Hardcoded structure in `CAREERS_SECTIONS`; not CMS copy. |

## Masthead

| Field | Current | New | Suggestions | Source/Notes |
| --- | --- | --- | --- | --- |
| Eyebrow | Careersss |  | Careers | CMS. Spelling currently has three `s` characters. |
| Title line | We hire the person |  | Build custom software. | CMS |
| Title line | who reads the shader. |  | Own the result. | CMS |
| Lead sentence 1 | Four to six of us, depending on the season - engineers and designers in one room, a chain of command you can cross in a sentence, work that ships with your name still on the commit. |  | At Voidix, engineers and designers work together on websites, apps, business systems, and AI products from the first decision through launch. | CMS |
| Lead sentence 2 | If that sounds like your size, we would like to read what you have built. |  | If you care about the details, question weak assumptions, and want real ownership of what ships, we would like to see your work. | CMS |

## Working Here

| Claim | Field | Current | New | Suggestions | Source/Notes |
| --- | --- | --- | --- | --- | --- |
| 01 | Claim | You own the surface. |  | Own a real part of the product. | CMS |
| 01 | Backing sentence | Not a ticket queue. |  | The work is larger than a ticket queue. | CMS |
| 01 | Backing sentence | A thing with edges, a date, and your judgement in the middle of it - including the judgement to say the plan was wrong. |  | You help define the problem, make the decisions, build the solution, and say when the plan needs to change. | CMS |
| 02 | Claim | The bar is the frame budget. |  | Performance has a budget. | CMS |
| 02 | Backing sentence | Nothing ships that cannot hold sixty frames on the laptop in the client's bag. |  | Every product gets a realistic target based on its users, devices, data, and visual complexity. | CMS |
| 02 | Backing sentence | It is the most useful argument-ender we have, and it does not care whose idea it was. |  | The measurement settles the argument, even when the expensive idea was ours. | CMS |
| 03 | Claim | You will be read. |  | Your work will be challenged and heard. | CMS |
| 03 | Backing sentence | Every line goes past someone who will ask why. |  | Expect someone to ask why a decision exists, and expect your answer to matter. | CMS |
| 03 | Backing sentence | It is the job's best part and its first week's worst, in that order. |  | The standard is demanding, the feedback is direct, and nobody gets extra points for pretending to know. | CMS |

## Open Roles

| Field | Current | New | Suggestions | Source/Notes |
| --- | --- | --- | --- | --- |
| Roles list | Empty |  | Keep empty until a real role is open. | CMS published roles are empty. This is a valid state. |
| Empty roles sentence | No roles are open right now - we hire when a surface needs an owner, not on a calendar. |  | No roles are open right now. We publish a role when there is real work ready for someone to own. | CMS |
| Empty roles invite | Write to us anyway |  | Send an open application | CMS |
| Role column label | What you'd own |  | What you would own | Hardcoded in `components/pages/Careers/RoleRow.tsx`. |
| Role column label | What we need to see |  | What we need to see | Hardcoded in `components/pages/Careers/RoleRow.tsx`. |
| Role column label | Nice, genuinely not required |  | Helpful, not required | Hardcoded in `components/pages/Careers/RoleRow.tsx`. |
| Role CTA label | Apply for this role |  | Apply for this role | Hardcoded in `components/pages/Careers/RoleRow.tsx`. |

## Hiring Phases

| Phase | Field | Current | New | Suggestions | Source/Notes |
| --- | --- | --- | --- | --- | --- |
| You write | Span | Day 0 |  | When you are ready | CMS |
| You write | Detail sentence | A note, and a link or a CV. |  | Send a short note and a link to your work, a CV, or both. | CMS |
| You write | Detail sentence | No cover letter, no form with nine required fields. |  | No formal cover letter and no form designed to test your patience. | CMS |
| We read the work | Span | Inside two days |  | Within 2 business days | CMS |
| We read the work | Detail sentence | The work first, the CV second. |  | We review the work first and use the CV for context. | CMS |
| We read the work | Detail sentence | You get an answer either way, from a person. |  | You receive a response either way from a person, not an automated silence. | CMS |
| Two conversations | Span | Week 1 |  | Usually in week 1 | CMS |
| Two conversations | Detail sentence | One about the craft, one about everything else. |  | One conversation covers your craft and decisions; the other covers the role, collaboration, and what you want next. | CMS |
| Two conversations | Detail sentence | No whiteboard algorithms. |  | We do not use whiteboard algorithms or surprise homework. | CMS |
| The offer, whole | Span | Week 2 |  | Usually by week 2 | CMS |
| The offer, whole | Detail sentence | Real numbers, a start date, and the name of the first surface you would own. |  | If there is a fit, the offer includes the compensation, terms, start date, and the first area you would own. | CMS |

## Open Application

| Field | Current | New | Suggestions | Source/Notes |
| --- | --- | --- | --- | --- |
| Open application title | Then write anyway. |  | No matching role? Apply anyway. | CMS |
| Open application lead sentence 1 | The list above is what we know we need, and it has been wrong before. |  | An open role is not the only way to start a useful conversation. | CMS |
| Open application lead sentence 2 | Tell us what you do and what you would want to own. |  | Tell us what you do well, show us the work, and explain what you would want to own at Voidix. | CMS |
| Open application subject | Open application |  | Open application | CMS |
| Open application seed | What I do, and what I would want to own: |  | What I do well and what I would want to own: | CMS |
| Commitment label | What you are looking for |  | What type of role are you looking for? | CMS |
| Commitment option | Full-time |  | Full-time | CMS |
| Commitment option | Part-time |  | Part-time | CMS |
| Commitment option | Internship |  | Internship | CMS |
| Application brief label | Why you |  | Why are you a strong fit? | CMS |
| Application submit label | Send it |  | Send application | CMS |
| Open application CTA | Write to us |  | Send an open application | Hardcoded in `components/pages/Careers/CareersPage.tsx`. |
| About invite | Read what the studio is first |  | See how Voidix works | CMS |
