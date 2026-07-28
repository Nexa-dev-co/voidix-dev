'use server';

import { revalidatePath } from 'next/cache';
import { MAX_WORKS_PROJECTS } from '@voidix/content';

import { createSupabaseServerClient } from '@/lib/supabaseServer';
import { publishContent, type PublishResult } from '@/lib/publishContent';
import type { ActionState } from '@/lib/actionState';

/**
 * Every write the panel makes. All of them run as the signed-in staff member, so RLS is the
 * authorisation — there is no service-role escape hatch in this app.
 *
 * `ActionState` and `IDLE_STATE` live in lib/actionState.ts: a `'use server'` module may only export
 * async functions, so a type or constant declared here would fail the build.
 */

/** Comma-separated inputs (capabilities, tags) → a clean array with the blanks dropped. */
function parseList(raw: FormDataEntryValue | null): string[] {
  return String(raw ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** A textarea of paragraphs → one entry per non-empty line. */
function parseParagraphs(raw: FormDataEntryValue | null): string[] {
  return String(raw ?? '')
    .split('\n')
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Services
// ─────────────────────────────────────────────────────────────────────────────────────────────────

export async function saveService(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const supabase = createSupabaseServerClient();

  const { error } = await supabase
    .from('services')
    .update({
      name: String(formData.get('name') ?? '').trim(),
      eyebrow: String(formData.get('eyebrow') ?? '').trim(),
      description: String(formData.get('description') ?? '').trim(),
      capabilities: parseList(formData.get('capabilities')),
      model_path: String(formData.get('model_path') ?? '').trim(),
    })
    .eq('id', String(formData.get('id')));

  if (error) return { error: error.message, notice: null };

  revalidatePath('/services');
  return { error: null, notice: 'Saved as draft.' };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Projects
// ─────────────────────────────────────────────────────────────────────────────────────────────────

export async function saveProject(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const supabase = createSupabaseServerClient();

  const { error } = await supabase
    .from('projects')
    .update({
      title: String(formData.get('title') ?? '').trim(),
      client: String(formData.get('client') ?? '').trim(),
      year: String(formData.get('year') ?? '').trim(),
      description: String(formData.get('description') ?? '').trim(),
      tags: parseList(formData.get('tags')),
    })
    .eq('id', String(formData.get('id')));

  if (error) return { error: error.message, notice: null };

  revalidatePath('/projects');
  return { error: null, notice: 'Saved as draft.' };
}

/**
 * Adding a project is capped by how many camera stops the works field actually has.
 *
 * This is the friendly half of the constraint — `contentPayloadSchema` enforces the same limit at
 * publish time, so even a row added directly in Supabase can't reach the site. Checking here as well
 * means staff get told why before they've typed anything, rather than at publish.
 */
export async function addProject(_previous: ActionState, _formData: FormData): Promise<ActionState> {
  const supabase = createSupabaseServerClient();

  const { count, error: countError } = await supabase
    .from('projects')
    .select('*', { count: 'exact', head: true });

  if (countError) return { error: countError.message, notice: null };

  if ((count ?? 0) >= MAX_WORKS_PROJECTS) {
    return {
      error:
        `The works field has ${MAX_WORKS_PROJECTS} authored camera stops, so it can show at most ` +
        `${MAX_WORKS_PROJECTS} projects. A fifth would have nowhere for the camera to fly to. ` +
        'Adding one means recording a new camera stop in the scene first — ask a developer.',
      notice: null,
    };
  }

  const { error } = await supabase.from('projects').insert({
    position: count ?? 0,
    title: 'Untitled project',
    client: 'Client',
    year: String(new Date().getFullYear()),
    description: 'Describe the work.',
    tags: [],
  });

  if (error) return { error: error.message, notice: null };

  revalidatePath('/projects');
  return { error: null, notice: 'Project added as a draft.' };
}

export async function deleteProject(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const supabase = createSupabaseServerClient();

  const { error } = await supabase.from('projects').delete().eq('id', String(formData.get('id')));
  if (error) return { error: error.message, notice: null };

  revalidatePath('/projects');
  return { error: null, notice: 'Project removed from the draft.' };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// FAQ — the one collection whose length is genuinely free (the hologram measures its own content)
// ─────────────────────────────────────────────────────────────────────────────────────────────────

export async function saveFaqEntry(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const supabase = createSupabaseServerClient();

  const answer = parseParagraphs(formData.get('answer'));
  if (answer.length === 0) {
    return { error: 'An answer needs at least one paragraph.', notice: null };
  }

  const { error } = await supabase
    .from('faq_entries')
    .update({ question: String(formData.get('question') ?? '').trim(), answer })
    .eq('id', String(formData.get('id')));

  if (error) return { error: error.message, notice: null };

  revalidatePath('/faq');
  return { error: null, notice: 'Saved as draft.' };
}

export async function addFaqEntry(_previous: ActionState, _formData: FormData): Promise<ActionState> {
  const supabase = createSupabaseServerClient();

  const { count } = await supabase.from('faq_entries').select('*', { count: 'exact', head: true });

  const { error } = await supabase.from('faq_entries').insert({
    position: count ?? 0,
    question: 'New question?',
    answer: ['The answer.'],
  });

  if (error) return { error: error.message, notice: null };

  revalidatePath('/faq');
  return { error: null, notice: 'Question added as a draft.' };
}

export async function deleteFaqEntry(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const supabase = createSupabaseServerClient();

  const { error } = await supabase.from('faq_entries').delete().eq('id', String(formData.get('id')));
  if (error) return { error: error.message, notice: null };

  revalidatePath('/faq');
  return { error: null, notice: 'Question removed from the draft.' };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Publish
// ─────────────────────────────────────────────────────────────────────────────────────────────────

export async function publish(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const result: PublishResult = await publishContent(String(formData.get('label') ?? ''));

  if (!result.ok) return { error: result.error ?? 'Publish failed.', notice: null };

  revalidatePath('/');

  return {
    error: null,
    notice: result.revalidateWarning
      ? `Published version ${result.version}. ${result.revalidateWarning}`
      : `Published version ${result.version}. voidix.tech is live with these changes.`,
  };
}
