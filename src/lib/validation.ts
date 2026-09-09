import { z } from 'zod';

export const PRIORITIES = ['high', 'medium', 'low'] as const;
export type Priority = (typeof PRIORITIES)[number];

/**
 * Trims a string field and turns an empty result into null, so that a field the
 * user left blank is stored as NULL rather than "".
 */
const optionalText = (max: number, label: string) =>
  z
    .string()
    .max(max, `${label} must be ${max} characters or fewer.`)
    .transform((value) => {
      const trimmed = value.trim();
      return trimmed.length === 0 ? null : trimmed;
    })
    .nullable()
    .optional()
    .transform((value) => value ?? null);

/**
 * The shape a client is allowed to submit. id, user_id, created_at and
 * updated_at are deliberately absent -- those are assigned by Postgres, and the
 * database revokes write privileges on them.
 *
 * This mirrors the CHECK constraints in db/schema.sql. The database is the
 * authority; this schema exists so the user gets an immediate, readable error
 * instead of a round trip and a raw constraint violation.
 */
export const contactInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required.')
    .max(120, 'Name must be 120 characters or fewer.'),
  company: optionalText(120, 'Company'),
  role: optionalText(120, 'Role'),
  where_met: optionalText(200, 'Where you met'),
  notes: optionalText(2000, 'Notes'),
  priority: z.enum(PRIORITIES, {
    message: 'Priority must be high, medium, or low.',
  }),
});

export type ContactInput = z.infer<typeof contactInputSchema>;

export type ValidationResult =
  | { ok: true; data: ContactInput }
  | { ok: false; errors: Record<string, string> };

/**
 * Validates raw form input and returns either the cleaned record or a
 * field-keyed map of messages suitable for rendering next to each input.
 */
export function validateContact(input: unknown): ValidationResult {
  const parsed = contactInputSchema.safeParse(input);

  if (parsed.success) {
    return { ok: true, data: parsed.data };
  }

  const errors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    const key = typeof field === 'string' ? field : '_form';
    // Keep the first message per field -- showing three messages under one
    // input is noise.
    if (!(key in errors)) {
      errors[key] = issue.message;
    }
  }

  return { ok: false, errors };
}

/**
 * Maps a Postgres error from the Data API onto a message a person can act on.
 * Constraint names come from db/schema.sql.
 */
export function messageForDatabaseError(error: {
  message?: string;
  code?: string;
  details?: string;
}): string {
  const haystack = `${error.message ?? ''} ${error.details ?? ''}`;

  if (haystack.includes('contacts_priority_valid')) {
    return 'Priority must be high, medium, or low.';
  }
  if (haystack.includes('contacts_name_not_blank')) {
    return 'Name is required.';
  }
  if (haystack.includes('contacts_name_max_len')) {
    return 'Name must be 120 characters or fewer.';
  }
  if (haystack.includes('_max_len')) {
    return 'One of the fields is too long. Please shorten it and try again.';
  }
  // 42501 is insufficient_privilege; PostgREST also returns this shape when an
  // RLS policy rejects a write.
  if (error.code === '42501' || haystack.includes('row-level security')) {
    return 'You do not have permission to change that contact.';
  }

  return error.message?.trim() || 'Something went wrong. Please try again.';
}
