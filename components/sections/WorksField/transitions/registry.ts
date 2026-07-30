import type { MarkTransitionFactory } from './markTransition';
import type { MarkTransitionId } from './transitionCatalog';
import { accretionTransitionFactory } from './accretionTransition';

/**
 * The built strategies, by id.
 *
 * Imports three.js once anything is registered, so this is client-only — the Server Component route
 * reads `transitionCatalog.ts` instead and hands the harness nothing but an id string.
 *
 * `Partial` on purpose: the catalogue lists every candidate and only some exist. The harness reports a
 * missing factory as "not built" rather than throwing, so a route can be linked before it is written.
 *
 * The first accretion attempt and the hard-cut control were removed rather than iterated on — see
 * `docs/accretion-plan.md` §1 for the six specific reasons, which is worth reading before adding
 * anything else here.
 */
export const MARK_TRANSITION_FACTORIES: Partial<
  Record<MarkTransitionId, MarkTransitionFactory>
> = {
  accretion: accretionTransitionFactory,
};
