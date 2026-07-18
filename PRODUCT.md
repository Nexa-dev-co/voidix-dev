# Product

## Register

brand

## Users

Prospective clients (founders, product leads, CTOs) evaluating a premium software studio, plus design-community judges (Awwwards). They arrive curious and skeptical of agency clichés; the site must prove capability by being the demonstration itself.

## Product Purpose

Voidix's single-page portfolio site. Not a marketing page — the site is the product demo: every interaction, animation, and visual must communicate innovation, technical excellence, precision engineering, and premium quality. Success = "could realistically compete on Awwwards."

## Brand Personality

Visionary, precise, premium. Also: intelligent, futuristic, confident. The metaphor universe is orbital systems, gravitational movement, celestial mechanics — "software with its own gravity." Emotional arc for visitors: curiosity → wonder → engagement → trust → excitement.

## Anti-references

- Generic agency/SaaS landing pages: hero + gradient + floating cards + feature grids
- Framer-style templates, startup aesthetics, corporate blandness
- Generic agency copy ("we build digital solutions", "your trusted partner")
- Basic fade-ins / slide-ins / scroll reveals; decorative 3D with no narrative purpose
- Minimalism for its own sake; trend-following

## Design Principles

1. **The site is the demo** — every element must itself prove engineering capability.
2. **Experiences, not pages** — sections are scenes (orbital systems, scroll-driven worlds), not layouts.
3. **Motion first** — motion is a design language with intent: morphing, spatial transitions, camera travel; never generic reveals.
4. **Purposeful 3D** — WebGL supports the orbital narrative (the shared sun, the fleet), never decoration.
5. **Ambition with performance** — 60fps interactions, fast load, clamped DPR; visual ambition never excuses jank.

## Accessibility & Inclusion

`prefers-reduced-motion` is honored everywhere via the `prefersReducedMotion()` helper — decorative motion is gated, reveals resolve fast/static. Scroll/snap and tap must always work on touch. No formal WCAG target declared; decorative HUD/telemetry elements are `aria-hidden` with semantic content (headline, nav) kept accessible.
