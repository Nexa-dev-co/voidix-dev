/**
 * The shape every server action in the panel returns.
 *
 * Lives here rather than beside the actions because a `'use server'` module may only export async
 * functions — exporting a type or a constant from one is a build error. Splitting them out is the
 * standard fix, and it also means client components can import the type without pulling the actions
 * into their graph.
 */
export interface ActionState {
  /** Something went wrong, phrased for the person reading it. */
  error: string | null;
  /** It worked — a short confirmation. */
  notice: string | null;
}

export const IDLE_STATE: ActionState = { error: null, notice: null };
