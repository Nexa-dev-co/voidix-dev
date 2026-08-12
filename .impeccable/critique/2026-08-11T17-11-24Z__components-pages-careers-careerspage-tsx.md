---
target: the /careers page
total_score: 25
p0_count: 0
p1_count: 4
timestamp: 2026-08-11T17-11-24Z
slug: components-pages-careers-careerspage-tsx
---
# Critique — /careers (components/pages/Careers/CareersPage.tsx)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Rail/disclosure feedback good; "Send it" produces zero visible response |
| 2 | Match System / Real World | 3 | Voice is human and on-audience |
| 3 | User Control and Freedom | 3 | Rail travel lands sections under the fixed navbar |
| 4 | Consistency and Standards | 3 | Static claim rows have stronger hover than interactive role rows; prose alpha varies 0.72 vs 0.38 |
| 5 | Error Prevention | 2 | Application dead-ends silently (no endpoint, no interim message) |
| 6 | Recognition Rather Than Recall | 3 | Expand affordance is a tiny 13px hairline "+" at 0.45 alpha |
| 7 | Flexibility and Efficiency | 3 | Multi-open desktop / accordion phone, seeded briefs — good |
| 8 | Aesthetic and Minimalist Design | 2 | Contrast collapse: most secondary text at 2.2–3.0:1, body at 13–14px |
| 9 | Error Recovery | 1 | Submit silently does nothing; no message explains why |
| 10 | Help and Documentation | 3 | "How hiring runs" is the help, and it's good |
| **Total** | | **25/40** | **Acceptable — significant improvements needed** |

## Anti-Patterns Verdict

**LLM assessment**: This does not read as AI-generated — the voice, the disclosure engineering, and the rail instrument are distinctive. What it reads as is *underexposed*: nearly everything secondary sits between 2.0:1 and 3.2:1 on the page black at 9–14px, so the page presents as whisper-gray hairlines with a lot of void. The "unprofessional" feel is a legibility/hierarchy problem, not a layout problem.

**Deterministic scan**: `detect.mjs` over `components/pages/Careers`, `components/layout/PageShell`, `app/careers` → **0 findings**. The markup is clean; every issue lives in CSS values.

**Browser overlays**: skipped — no browser automation in this environment, and project convention is the user runs the app.

## Priority Issues

- **[P1] Secondary-text contrast collapse.** Measured on `#060606`: `--muted` (0.38 alpha) ≈ **3.0:1** and carries the lead, role bullets, role meta, claim backing, and track detail — the page's actual substance — at 13–14px. `fg/0.3` column titles ("What you'd own") ≈ **2.28:1**. Quiet chips `fg/0.4` ≈ **3.2:1** at 10px. Footer group titles/base ≈ 2.0–2.1:1. All fail WCAG AA (4.5:1). Fix: doc-scoped text colors — body copy ≥ 0.7 alpha (≈8.6:1, what `.doc-paragraph` already uses), labels ≥ 0.45, chips ≥ 0.55.
- **[P1] Prose size is HUD-scaled, not document-scaled.** `--fs-body` caps at 14px — tuned for the homepage's cinematic overlays, reused for paragraphs of role copy. Fix: a doc-scoped body size (~15→16.5px fluid) for lead, backing, bullets, detail.
- **[P1] Anchor travel buries section heads under the navbar.** `travelToSection` scrolls target top to 0; `.nav-root` is fixed at ~4.5rem. Also affects `/careers#open-roles` deep links. Fix: `scroll-margin-top` on `.doc-section`.
- **[P1 · known/deferred] "Send it" does nothing.** `handleSubmit` prevents default; no endpoint, no message. Recorded in `careersContent.ts` header as deliberate — but it is the launch blocker for this page, and doubly so for job applications.
- **[P2] The page's main control has the weakest affordance on it.** Role toggles: tiny faint `+`, hover only recolors the small index number — while the *static* claim rows above get an edge-light on hover. Inverted affordance hierarchy.
- **[P2] Rail measurements go stale when a role opens.** `useOrbitRail` measures section offsets on mount/resize/fonts only; opening a role shifts sections 03/04 down by hundreds of px → wrong active station. Fix: re-measure on layout change (ResizeObserver).
- **[P2] No empty state for roles.** The content file says all four roles are invented and may be cut; an empty `CAREER_ROLES` renders a bare heading over nothing.

## Persona Red Flags

**Jordan (first-time applicant)**: May never discover rows expand (faint distant `+`). After "Send it", nothing happens — leaves believing they applied, or confused. Reads role bullets at 13px/3:1.

**Sam (accessibility)**: Disclosure semantics are genuinely excellent (aria-expanded, visibility-based tab removal). But nearly all secondary text fails AA contrast, and in-page navigation lands content under the fixed bar.

**Casey (mobile)**: Accordion + hairline progress are right. 13px text at 3:1 at arm's length in daylight is the failure.

## Minor Observations

- Masthead eyebrow "Careers — Voidix" duplicates the wordmark sitting directly above it in the navbar.
- Narrow-viewport collapse comment says "keep the most recently opened" role; code closes all (`new Set()`).
- `.doc-role-sign` bars at `fg/0.45` ≈ 3.4:1 — barely passes non-text contrast.
- "Read what the studio is first" cross-link is nearly invisible (tiny + muted) next to the CTA.
- Phase track line renders as broken segments (grid gap interrupts it), not the continuous track the component's header art shows.
- `.doc-quote` (About page) uses a 2px accent left-stripe — the skill's side-stripe ban; out of scope here.

## Questions to Consider

- Should a careers page on a black site whisper? The studio's voice is confident; the type color is timid.
- What does an applicant see 10 seconds after pressing "Send it"?
- If the real roles list is empty at launch, what does section 02 say?
