'use client';

import { getNeonClient, type Contact } from './neon';
import {
  messageForDatabaseError,
  validateContact,
  type ContactInput,
  type Priority,
} from './validation';

export type { Contact };

export const SORT_FIELDS = {
  created_at: 'Recently added',
  name: 'Name',
  company: 'Company',
  priority_rank: 'Priority',
} as const;

export type SortField = keyof typeof SORT_FIELDS;
export type SortDirection = 'asc' | 'desc';

export type ListOptions = {
  sortField: SortField;
  sortDirection: SortDirection;
  /** 'all' means no priority filter. */
  priority: Priority | 'all';
  /** Free-text match against name and company. */
  search: string;
};

/**
 * Every data-layer call returns this instead of throwing, so the UI always has
 * a message to render and never has to interpret a raw Postgres error.
 */
export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; message: string; fieldErrors?: Record<string, string> };

/**
 * Escapes the PostgREST `or=` filter metacharacters. Commas separate
 * conditions and parentheses delimit them, so a search for "Smith, Jane" would
 * otherwise be parsed as two conditions.
 */
function escapeForOrFilter(value: string): string {
  return value.replace(/[,()]/g, ' ');
}

/**
 * Reads the signed-in user's contacts.
 *
 * Note there is no `.eq('user_id', ...)` here, and deliberately so: the SELECT
 * policy in db/schema.sql already restricts the result to rows the caller owns.
 * Filtering by user in the client would imply the client is what enforces
 * privacy. It isn't -- Postgres is.
 */
export async function listContacts(options: ListOptions): Promise<Result<Contact[]>> {
  const client = getNeonClient();

  let query = client.from('contacts').select('*');

  if (options.priority !== 'all') {
    query = query.eq('priority', options.priority);
  }

  const search = options.search.trim();
  if (search.length > 0) {
    const term = escapeForOrFilter(search);
    query = query.or(`name.ilike.%${term}%,company.ilike.%${term}%`);
  }

  query = query.order(options.sortField, {
    ascending: options.sortDirection === 'asc',
  });

  // Stable tiebreaker, so rows with equal priority or company keep a
  // predictable order between renders.
  if (options.sortField !== 'created_at') {
    query = query.order('created_at', { ascending: false });
  }

  const { data, error } = await query;

  if (error) {
    return { ok: false, message: messageForDatabaseError(error) };
  }

  return { ok: true, data: (data ?? []) as Contact[] };
}

export async function createContact(input: unknown): Promise<Result<Contact>> {
  const validated = validateContact(input);
  if (!validated.ok) {
    return {
      ok: false,
      message: 'Please fix the highlighted fields.',
      fieldErrors: validated.errors,
    };
  }

  const client = getNeonClient();

  // user_id is not sent. Postgres fills it from auth.user_id() via the column
  // DEFAULT, and the INSERT policy's WITH CHECK verifies the result.
  const { data, error } = await client
    .from('contacts')
    .insert(validated.data satisfies ContactInput)
    .select()
    .single();

  if (error) {
    return { ok: false, message: messageForDatabaseError(error) };
  }

  return { ok: true, data: data as Contact };
}

export async function updateContact(id: string, input: unknown): Promise<Result<Contact>> {
  const validated = validateContact(input);
  if (!validated.ok) {
    return {
      ok: false,
      message: 'Please fix the highlighted fields.',
      fieldErrors: validated.errors,
    };
  }

  const client = getNeonClient();

  const { data, error } = await client
    .from('contacts')
    .update(validated.data satisfies ContactInput)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return { ok: false, message: messageForDatabaseError(error) };
  }

  // A row belonging to another user matches `id` but fails the UPDATE policy,
  // so Postgres updates zero rows and PostgREST returns no row rather than an
  // error. Treat that as the permission failure it is.
  if (!data) {
    return { ok: false, message: 'You do not have permission to change that contact.' };
  }

  return { ok: true, data: data as Contact };
}

export async function deleteContact(id: string): Promise<Result<string>> {
  const client = getNeonClient();

  const { data, error } = await client
    .from('contacts')
    .delete()
    .eq('id', id)
    .select('id');

  if (error) {
    return { ok: false, message: messageForDatabaseError(error) };
  }

  // Same reasoning as updateContact: the DELETE policy filters the row out
  // silently, so "nothing came back" means "not yours".
  if (!data || data.length === 0) {
    return { ok: false, message: 'You do not have permission to delete that contact.' };
  }

  return { ok: true, data: id };
}
