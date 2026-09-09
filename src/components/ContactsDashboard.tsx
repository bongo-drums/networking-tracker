'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  SORT_FIELDS,
  createContact,
  deleteContact,
  listContacts,
  updateContact,
  type Contact,
  type ListOptions,
  type SortField,
} from '@/lib/contacts';
import { PRIORITIES, type Priority } from '@/lib/validation';
import { ContactForm, type ContactDraft } from './ContactForm';
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Notice,
  PriorityBadge,
  Select,
  Spinner,
} from './ui';

const defaultOptions: ListOptions = {
  sortField: 'created_at',
  sortDirection: 'desc',
  priority: 'all',
  search: '',
};

type Editing = { mode: 'closed' } | { mode: 'new' } | { mode: 'edit'; contact: Contact };

export function ContactsDashboard({
  userLabel,
  onSignOut,
}: {
  userLabel: string;
  onSignOut: () => Promise<void>;
}) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [options, setOptions] = useState<ListOptions>(defaultOptions);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>({ mode: 'closed' });
  const [pendingDelete, setPendingDelete] = useState<Contact | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  // Whether the user has any contacts at all, as opposed to none matching the
  // current filters. The two need different empty states.
  const [hasAnyContacts, setHasAnyContacts] = useState(false);

  const refresh = useCallback(async (next: ListOptions) => {
    setLoading(true);
    const result = await listContacts(next);
    if (result.ok) {
      setContacts(result.data);
      setError(null);
      const unfiltered = next.priority === 'all' && next.search.trim() === '';
      if (unfiltered) setHasAnyContacts(result.data.length > 0);
      else if (result.data.length > 0) setHasAnyContacts(true);
    } else {
      setError(result.message);
    }
    setLoading(false);
  }, []);

  // Debounced so typing in the search box does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      void refresh(options);
    }, options.search ? 250 : 0);
    return () => clearTimeout(timer);
  }, [options, refresh]);

  function setOption<K extends keyof ListOptions>(key: K, value: ListOptions[K]) {
    setOptions((previous) => ({ ...previous, [key]: value }));
  }

  function flash(message: string) {
    setSuccess(message);
    setTimeout(() => setSuccess(null), 4000);
  }

  async function handleCreate(draft: ContactDraft) {
    const result = await createContact(draft);
    if (result.ok) {
      setEditing({ mode: 'closed' });
      flash(`Added ${result.data.name}.`);
      await refresh(options);
    }
    return result.ok ? { ok: true } : { ok: false, message: result.message, fieldErrors: result.fieldErrors };
  }

  async function handleUpdate(id: string, draft: ContactDraft) {
    const result = await updateContact(id, draft);
    if (result.ok) {
      setEditing({ mode: 'closed' });
      flash(`Updated ${result.data.name}.`);
      await refresh(options);
    }
    return result.ok ? { ok: true } : { ok: false, message: result.message, fieldErrors: result.fieldErrors };
  }

  async function handleDelete(contact: Contact) {
    const result = await deleteContact(contact.id);
    setPendingDelete(null);
    if (result.ok) {
      flash(`Deleted ${contact.name}.`);
      await refresh(options);
    } else {
      setError(result.message);
    }
  }

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await onSignOut();
    } finally {
      setSigningOut(false);
    }
  }

  const filtersActive = options.priority !== 'all' || options.search.trim() !== '';

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-foreground">
              Networking Tracker
            </h1>
            <p className="text-sm text-muted">{userLabel}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={handleSignOut} disabled={signingOut}>
            {signingOut ? 'Signing out…' : 'Sign out'}
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        <div className="flex flex-col gap-4">
          {error && (
            <Notice tone="error" onDismiss={() => setError(null)}>
              {error}
            </Notice>
          )}
          {success && (
            <Notice tone="success" onDismiss={() => setSuccess(null)}>
              {success}
            </Notice>
          )}

          {editing.mode !== 'closed' ? (
            <Card className="p-5 sm:p-6">
              <h2 className="mb-4 text-base font-semibold text-foreground">
                {editing.mode === 'new' ? 'Add a contact' : `Edit ${editing.contact.name}`}
              </h2>
              <ContactForm
                contact={editing.mode === 'edit' ? editing.contact : undefined}
                onCancel={() => setEditing({ mode: 'closed' })}
                onSubmit={(draft) =>
                  editing.mode === 'new'
                    ? handleCreate(draft)
                    : handleUpdate(editing.contact.id, draft)
                }
              />
            </Card>
          ) : (
            <Toolbar
              options={options}
              onChange={setOption}
              onAdd={() => setEditing({ mode: 'new' })}
            />
          )}

          <Card>
            {loading ? (
              <div className="flex justify-center px-6 py-14">
                <Spinner label="Loading your contacts…" />
              </div>
            ) : contacts.length === 0 ? (
              hasAnyContacts && filtersActive ? (
                <EmptyState
                  title="No contacts match those filters"
                  description="Try a different search term or clear the priority filter."
                  action={
                    <Button variant="secondary" size="sm" onClick={() => setOptions(defaultOptions)}>
                      Clear filters
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  title="No contacts yet"
                  description="Add the first person you want to stay in touch with. Only you can see your contacts."
                  action={
                    <Button size="sm" onClick={() => setEditing({ mode: 'new' })}>
                      Add your first contact
                    </Button>
                  }
                />
              )
            ) : (
              <ContactTable
                contacts={contacts}
                onEdit={(contact) => setEditing({ mode: 'edit', contact })}
                onDelete={setPendingDelete}
              />
            )}
          </Card>

          {!loading && contacts.length > 0 && (
            <p className="text-sm text-muted">
              {contacts.length} {contacts.length === 1 ? 'contact' : 'contacts'}
              {filtersActive && ' matching your filters'}
            </p>
          )}
        </div>
      </main>

      {pendingDelete && (
        <ConfirmDelete
          contact={pendingDelete}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => handleDelete(pendingDelete)}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Toolbar({
  options,
  onChange,
  onAdd,
}: {
  options: ListOptions;
  onChange: <K extends keyof ListOptions>(key: K, value: ListOptions[K]) => void;
  onAdd: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="grid flex-1 gap-3 sm:grid-cols-3">
        <Field label="Search" htmlFor="search">
          <Input
            id="search"
            type="search"
            placeholder="Name or company"
            value={options.search}
            onChange={(event) => onChange('search', event.target.value)}
          />
        </Field>

        <Field label="Priority" htmlFor="filter-priority">
          <Select
            id="filter-priority"
            value={options.priority}
            onChange={(event) => onChange('priority', event.target.value as Priority | 'all')}
          >
            <option value="all">All priorities</option>
            {PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {priority.charAt(0).toUpperCase() + priority.slice(1)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Sort by" htmlFor="sort-field">
          <div className="flex gap-2">
            <Select
              id="sort-field"
              value={options.sortField}
              onChange={(event) => onChange('sortField', event.target.value as SortField)}
            >
              {Object.entries(SORT_FIELDS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <Button
              variant="secondary"
              type="button"
              aria-label={
                options.sortDirection === 'asc' ? 'Sort descending' : 'Sort ascending'
              }
              title={options.sortDirection === 'asc' ? 'Ascending' : 'Descending'}
              onClick={() =>
                onChange('sortDirection', options.sortDirection === 'asc' ? 'desc' : 'asc')
              }
              className="shrink-0 px-3"
            >
              {options.sortDirection === 'asc' ? '↑' : '↓'}
            </Button>
          </div>
        </Field>
      </div>

      <Button onClick={onAdd} className="shrink-0 sm:mb-0">
        Add contact
      </Button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * A table on wide screens; a stack of cards on phones, where a six-column table
 * would either overflow or crush every column.
 */
function ContactTable({
  contacts,
  onEdit,
  onDelete,
}: {
  contacts: Contact[];
  onEdit: (contact: Contact) => void;
  onDelete: (contact: Contact) => void;
}) {
  return (
    <>
      {/* Mobile */}
      <ul className="divide-y divide-line md:hidden">
        {contacts.map((contact) => (
          <li key={contact.id} className="flex flex-col gap-2 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">{contact.name}</p>
                <p className="truncate text-sm text-muted">
                  {[contact.role, contact.company].filter(Boolean).join(' · ') || '—'}
                </p>
              </div>
              <PriorityBadge priority={contact.priority} />
            </div>
            {contact.where_met && (
              <p className="text-sm text-muted">Met at {contact.where_met}</p>
            )}
            {contact.notes && (
              <p className="text-sm whitespace-pre-wrap text-foreground/80">{contact.notes}</p>
            )}
            <div className="mt-1 flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => onEdit(contact)}>
                Edit
              </Button>
              <Button variant="danger" size="sm" onClick={() => onDelete(contact)}>
                Delete
              </Button>
            </div>
          </li>
        ))}
      </ul>

      {/* Desktop */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line text-xs uppercase tracking-wide text-muted">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">Name</th>
              <th scope="col" className="px-4 py-3 font-medium">Company</th>
              <th scope="col" className="px-4 py-3 font-medium">Role</th>
              <th scope="col" className="px-4 py-3 font-medium">Where met</th>
              <th scope="col" className="px-4 py-3 font-medium">Priority</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {contacts.map((contact) => (
              <tr key={contact.id} className="align-top">
                <td className="px-4 py-3">
                  <p className="font-medium text-foreground">{contact.name}</p>
                  {contact.notes && (
                    <p className="mt-1 max-w-xs text-xs whitespace-pre-wrap text-muted">
                      {contact.notes}
                    </p>
                  )}
                </td>
                <td className="px-4 py-3 text-muted">{contact.company || '—'}</td>
                <td className="px-4 py-3 text-muted">{contact.role || '—'}</td>
                <td className="px-4 py-3 text-muted">{contact.where_met || '—'}</td>
                <td className="px-4 py-3">
                  <PriorityBadge priority={contact.priority} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-2">
                    <Button variant="secondary" size="sm" onClick={() => onEdit(contact)}>
                      Edit
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => onDelete(contact)}>
                      Delete
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */

function ConfirmDelete({
  contact,
  onCancel,
  onConfirm,
}: {
  contact: Contact;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-delete-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
    >
      <Card className="w-full max-w-sm p-5">
        <h2 id="confirm-delete-title" className="text-base font-semibold text-foreground">
          Delete {contact.name}?
        </h2>
        <p className="mt-2 text-sm text-muted">This cannot be undone.</p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            Delete
          </Button>
        </div>
      </Card>
    </div>
  );
}
