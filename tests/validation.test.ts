import { describe, expect, it } from 'vitest';
import {
  PRIORITIES,
  messageForDatabaseError,
  validateContact,
} from '@/lib/validation';

/**
 * These tests cover the validation rules that the UI relies on. The same rules
 * are enforced independently by CHECK constraints in db/schema.sql -- this
 * suite proves the client-side half rejects bad input before it is ever sent.
 */

const valid = {
  name: 'Ada Lovelace',
  company: 'Analytical Engines',
  role: 'Mathematician',
  where_met: 'Berkeley AI mixer',
  notes: 'Follow up about the notes on Bernoulli numbers.',
  priority: 'high',
};

describe('validateContact — accepts good input', () => {
  it('accepts a fully populated contact', () => {
    const result = validateContact(valid);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.name).toBe('Ada Lovelace');
    expect(result.data.priority).toBe('high');
  });

  it('accepts every allowed priority', () => {
    for (const priority of PRIORITIES) {
      const result = validateContact({ ...valid, priority });
      expect(result.ok, `priority "${priority}" should be accepted`).toBe(true);
    }
  });

  it('trims surrounding whitespace from the name', () => {
    const result = validateContact({ ...valid, name: '   Grace Hopper   ' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.name).toBe('Grace Hopper');
  });

  it('stores blank optional fields as null rather than empty strings', () => {
    const result = validateContact({
      name: 'Alan Turing',
      company: '',
      role: '   ',
      where_met: '',
      notes: '',
      priority: 'low',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.company).toBeNull();
    expect(result.data.role).toBeNull();
    expect(result.data.where_met).toBeNull();
    expect(result.data.notes).toBeNull();
  });
});

describe('validateContact — rejects an empty name', () => {
  it('rejects an empty string', () => {
    const result = validateContact({ ...valid, name: '' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.name).toBe('Name is required.');
  });

  it('rejects a name that is only whitespace', () => {
    const result = validateContact({ ...valid, name: '     ' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.name).toBe('Name is required.');
  });

  it('rejects a missing name', () => {
    const { name: _omitted, ...withoutName } = valid;
    const result = validateContact(withoutName);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.name).toBeDefined();
  });

  it('rejects a name longer than 120 characters', () => {
    const result = validateContact({ ...valid, name: 'a'.repeat(121) });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.name).toBe('Name must be 120 characters or fewer.');
  });
});

describe('validateContact — rejects an invalid priority', () => {
  it.each(['urgent', 'HIGH', 'Medium', '', 'none', '1'])(
    'rejects the priority %o',
    (priority) => {
      const result = validateContact({ ...valid, priority });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors.priority).toBe('Priority must be high, medium, or low.');
    },
  );

  it('rejects a non-string priority', () => {
    const result = validateContact({ ...valid, priority: 3 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.priority).toBeDefined();
  });
});

describe('validateContact — reports every bad field at once', () => {
  it('returns errors for both name and priority', () => {
    const result = validateContact({ name: '  ', priority: 'urgent' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.name).toBe('Name is required.');
    expect(result.errors.priority).toBe('Priority must be high, medium, or low.');
  });
});

describe('validateContact — strips fields the client may not set', () => {
  it('drops user_id, id and timestamps from the accepted payload', () => {
    const result = validateContact({
      ...valid,
      id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      user_id: 'some-other-users-id',
      created_at: '1999-01-01T00:00:00Z',
      updated_at: '1999-01-01T00:00:00Z',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Ownership is assigned by Postgres, never accepted from the client. Even
    // if this slipped through, the INSERT policy's WITH CHECK and the
    // column-level REVOKE in db/schema.sql would reject it.
    expect(result.data).not.toHaveProperty('user_id');
    expect(result.data).not.toHaveProperty('id');
    expect(result.data).not.toHaveProperty('created_at');
    expect(result.data).not.toHaveProperty('updated_at');
  });
});

describe('messageForDatabaseError', () => {
  it('translates the priority CHECK constraint into a readable message', () => {
    const message = messageForDatabaseError({
      message: 'new row for relation "contacts" violates check constraint "contacts_priority_valid"',
      code: '23514',
    });

    expect(message).toBe('Priority must be high, medium, or low.');
  });

  it('translates the blank-name CHECK constraint', () => {
    const message = messageForDatabaseError({
      message: 'violates check constraint "contacts_name_not_blank"',
      code: '23514',
    });

    expect(message).toBe('Name is required.');
  });

  it('translates a row level security rejection into a permission message', () => {
    const message = messageForDatabaseError({
      message: 'new row violates row-level security policy for table "contacts"',
      code: '42501',
    });

    expect(message).toBe('You do not have permission to change that contact.');
  });

  it('falls back to a generic message when the error is unrecognised', () => {
    const message = messageForDatabaseError({ message: '' });

    expect(message).toBe('Something went wrong. Please try again.');
  });
});
