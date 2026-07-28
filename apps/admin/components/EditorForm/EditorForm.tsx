'use client';

import { useFormState, useFormStatus } from 'react-dom';
import type { ReactNode } from 'react';

import { IDLE_STATE, type ActionState } from '@/lib/actionState';

/**
 * One form, one server action, with the pending / error / confirmation states handled once.
 *
 * Every editor in the panel is the same shape — fields, a button, a message — so this exists to stop
 * that being retyped six times and drifting. The submit button lives inside `useFormStatus`, which
 * only reports pending when it's rendered within the form it belongs to.
 */

interface EditorFormProps {
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  children: ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  /** Renders the button in the destructive style, for removals. */
  destructive?: boolean;
  /** Shown under the button — e.g. why an action is unavailable. */
  hint?: string;
  disabled?: boolean;
}

function SubmitButton({
  label,
  pendingLabel,
  destructive,
  disabled,
}: {
  label: string;
  pendingLabel: string;
  destructive: boolean;
  disabled: boolean;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      className={`button ${destructive ? 'button-danger' : 'button-primary'}`}
      disabled={pending || disabled}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

export default function EditorForm({
  action,
  children,
  submitLabel,
  pendingLabel = 'Saving…',
  destructive = false,
  hint,
  disabled = false,
}: EditorFormProps) {
  const [state, formAction] = useFormState(action, IDLE_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {children}

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton
          label={submitLabel}
          pendingLabel={pendingLabel}
          destructive={destructive}
          disabled={disabled}
        />

        {state.notice ? (
          <p className="text-sm" style={{ color: 'var(--accent)' }} role="status">
            {state.notice}
          </p>
        ) : null}
      </div>

      {state.error ? (
        <p
          role="alert"
          className="text-sm leading-relaxed panel-card p-3"
          style={{ color: 'var(--danger)', borderColor: 'rgba(255,94,71,0.3)' }}
        >
          {state.error}
        </p>
      ) : null}

      {hint ? <p className="field-hint">{hint}</p> : null}
    </form>
  );
}
