'use server';

import { redirect } from 'next/navigation';

import { createSupabaseServerClient } from '@/lib/supabaseServer';

export interface SignInState {
  error: string | null;
}

/**
 * Sign in with email and password.
 *
 * The error message is deliberately the same whether the address is unknown or the password is
 * wrong — telling them apart tells an attacker which addresses have accounts here.
 */
export async function signIn(_previous: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const next = String(formData.get('next') ?? '/');

  if (!email || !password) {
    return { error: 'Enter your email and password.' };
  }

  const supabase = createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: 'That email and password combination is not recognised.' };
  }

  // Only ever redirect within this app — `next` comes from the URL, so treating it as trusted would
  // be an open redirect.
  redirect(next.startsWith('/') && !next.startsWith('//') ? next : '/');
}

export async function signOut(): Promise<void> {
  const supabase = createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect('/login');
}
