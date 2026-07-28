// The database's own shapes — snake_case, exactly as the tables in supabase/migrations declare them.
//
// These are hand-written rather than generated with `supabase gen types`, because generating requires
// a live project and this package has to typecheck before one exists. Once the project is up, running
// the generator and diffing against this file is a cheap way to prove the two agree.
//
// Nothing outside this package should import these. The rest of the codebase speaks in the domain
// types from @voidix/content, and mappers.ts is the only place the two vocabularies meet.

/** What Postgres gives back for a `jsonb` column: structurally unknown until validated. */
export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export interface ServiceRow {
  id: string;
  position: number;
  name: string;
  eyebrow: string;
  description: string;
  capabilities: string[];
  model_path: string;
  profile: Json;
  light: Json | null;
  model_rotation: Json | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectRow {
  id: string;
  position: number;
  title: string;
  client: string;
  year: string;
  description: string;
  tags: string[];
  rock: Json | null;
  created_at: string;
  updated_at: string;
}

export interface FaqEntryRow {
  id: string;
  position: number;
  question: string;
  answer: string[];
  created_at: string;
  updated_at: string;
}

export interface ContentPublicationRow {
  id: number;
  payload: Json;
  version: number;
  label: string | null;
  published_at: string;
  published_by: string | null;
}

export interface SceneTuningRow {
  scene_key: string;
  data: Json;
  version: number;
  updated_at: string;
  updated_by: string | null;
}

export interface SceneTuningPublishedRow {
  scene_key: string;
  data: Json;
  version: number;
  published_at: string;
  published_by: string | null;
}

export type LeadStatus = 'new' | 'read' | 'replied' | 'qualified' | 'won' | 'lost' | 'spam';

export interface LeadRow {
  id: string;
  created_at: string;
  name: string;
  email: string;
  message: string;
  company: string | null;
  payload: Json;
  source_path: string | null;
  referrer: string | null;
  ip_hash: string | null;
  user_agent: string | null;
  status: LeadStatus;
  notes: string | null;
  handled_by: string | null;
  handled_at: string | null;
}

/** Columns the database fills in itself, and which an insert must therefore omit. */
type Generated = 'id' | 'created_at' | 'updated_at';

export type ServiceInsert  = Omit<ServiceRow, Generated>;
export type ProjectInsert  = Omit<ProjectRow, Generated>;
export type FaqEntryInsert = Omit<FaqEntryRow, Generated>;
