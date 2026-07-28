'use client';

import { useFormState, useFormStatus } from 'react-dom';

import { signIn, type SignInState } from './actions';

const INITIAL_STATE: SignInState = { error: null };

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button type="submit" className="button button-primary w-full justify-center" disabled={pending}>
      {pending ? 'Signing in…' : 'Sign in'}
    </button>
  );
}

export default function LoginForm({ next }: { next: string }) {
  const [state, formAction] = useFormState(signIn, INITIAL_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="next" value={next} />

      <div>
        <label className="field-label" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          autoFocus
          className="field-input"
        />
      </div>

      <div>
        <label className="field-label" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="field-input"
        />
      </div>

      {state.error ? (
        <p role="alert" className="text-sm" style={{ color: 'var(--danger)' }}>
          {state.error}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}
