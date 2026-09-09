'use client';

import { useState } from 'react';
import type { Contact } from '@/lib/contacts';
import { PRIORITIES, type Priority } from '@/lib/validation';
import { Button, Field, Input, Notice, Select, Textarea } from './ui';

export type ContactDraft = {
  name: string;
  company: string;
  role: string;
  where_met: string;
  notes: string;
  priority: Priority;
};

const emptyDraft: ContactDraft = {
  name: '',
  company: '',
  role: '',
  where_met: '',
  notes: '',
  priority: 'medium',
};

function draftFrom(contact: Contact): ContactDraft {
  return {
    name: contact.name,
    company: contact.company ?? '',
    role: contact.role ?? '',
    where_met: contact.where_met ?? '',
    notes: contact.notes ?? '',
    priority: contact.priority,
  };
}

/**
 * Add / edit form. Submission is delegated to `onSubmit`, which runs the shared
 * validator and calls the Data API; this component only renders whatever errors
 * come back.
 */
export function ContactForm({
  contact,
  onSubmit,
  onCancel,
}: {
  /** Present when editing; absent when adding. */
  contact?: Contact;
  onSubmit: (draft: ContactDraft) => Promise<{
    ok: boolean;
    message?: string;
    fieldErrors?: Record<string, string>;
  }>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<ContactDraft>(
    contact ? draftFrom(contact) : emptyDraft,
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isEditing = Boolean(contact);

  function update<K extends keyof ContactDraft>(key: K, value: ContactDraft[K]) {
    setDraft((previous) => ({ ...previous, [key]: value }));
    // Clear the error for a field as soon as the user edits it, so the message
    // does not linger while they are fixing it.
    setFieldErrors((previous) => {
      if (!(key in previous)) return previous;
      const { [key]: _cleared, ...rest } = previous;
      return rest;
    });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setSubmitting(true);

    try {
      const result = await onSubmit(draft);
      if (!result.ok) {
        setFieldErrors(result.fieldErrors ?? {});
        setFormError(result.fieldErrors ? null : (result.message ?? 'Could not save.'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    // noValidate turns off the browser's own bubbles so the app's validation --
    // the same rules the database enforces -- is the single visible source of
    // truth.
    <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
      {formError && <Notice tone="error">{formError}</Notice>}

      <Field label="Name" htmlFor="contact-name" required error={fieldErrors.name}>
        <Input
          id="contact-name"
          value={draft.name}
          invalid={Boolean(fieldErrors.name)}
          placeholder="Jane Chen"
          onChange={(event) => update('name', event.target.value)}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Company" htmlFor="contact-company" error={fieldErrors.company}>
          <Input
            id="contact-company"
            value={draft.company}
            invalid={Boolean(fieldErrors.company)}
            placeholder="Anthropic"
            onChange={(event) => update('company', event.target.value)}
          />
        </Field>

        <Field label="Role" htmlFor="contact-role" error={fieldErrors.role}>
          <Input
            id="contact-role"
            value={draft.role}
            invalid={Boolean(fieldErrors.role)}
            placeholder="Research Engineer"
            onChange={(event) => update('role', event.target.value)}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Where you met" htmlFor="contact-where" error={fieldErrors.where_met}>
          <Input
            id="contact-where"
            value={draft.where_met}
            invalid={Boolean(fieldErrors.where_met)}
            placeholder="AI Club mixer, Soda Hall"
            onChange={(event) => update('where_met', event.target.value)}
          />
        </Field>

        <Field label="Priority" htmlFor="contact-priority" required error={fieldErrors.priority}>
          <Select
            id="contact-priority"
            value={draft.priority}
            invalid={Boolean(fieldErrors.priority)}
            onChange={(event) => update('priority', event.target.value as Priority)}
          >
            {PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {priority.charAt(0).toUpperCase() + priority.slice(1)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="Notes" htmlFor="contact-notes" error={fieldErrors.notes}>
        <Textarea
          id="contact-notes"
          value={draft.notes}
          invalid={Boolean(fieldErrors.notes)}
          placeholder="What you talked about, what to follow up on…"
          onChange={(event) => update('notes', event.target.value)}
        />
      </Field>

      <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Saving…' : isEditing ? 'Save changes' : 'Add contact'}
        </Button>
      </div>
    </form>
  );
}
