# Agent instructions

**Read [`CLAUDE.md`](./CLAUDE.md) first.** It carries the creative brief, the architecture of the
site as it actually exists, and the code style rules. This file exists only to point at it.

Current state and plan of record: [`docs/site-completion-plan.md`](./docs/site-completion-plan.md).

## Two things that catch people out

1. **The whole public site is one pinned ScrollTrigger.** Sections are overlays inside the hero,
   not siblings in the page. See CLAUDE.md → "The scroll spine".
2. **The user runs the app.** Verify with `npx tsc --noEmit` and `npm run build`, self-review the
   diff, then hand off — stating plainly what still needs eyes on it.

> **Note:** this repo runs **stock Next.js 14.2** (App Router). An earlier version of this file
> carried a boilerplate warning that "this is NOT the Next.js you know" and told you to read
> `node_modules/next/dist/docs/` before writing code. That did not apply here and has been removed.
