-- ============================================================================
-- Secure Networking Tracker — database schema
--
-- Run this once against your Neon branch (Neon Console → SQL Editor), AFTER
-- you have enabled Neon Auth (Managed Better Auth) and the Data API on that
-- branch. Neon Auth is what provides the auth.user_id() function used below;
-- the statements will fail with "schema auth does not exist" if you run this
-- first.
--
-- This file is the trusted enforcement layer. Every rule that matters for
-- correctness or privacy lives here, in the database, so that it holds even if
-- a client bypasses the UI and calls the Data API directly.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- Table
-- ----------------------------------------------------------------------------
create table if not exists public.contacts (
  id         uuid        primary key default gen_random_uuid(),

  -- Ownership column. The DEFAULT means a client never has to send user_id --
  -- Postgres stamps the row with the identity from the caller's JWT. NOT NULL
  -- means a row can never exist without an owner.
  user_id    text        not null default auth.user_id(),

  name       text        not null,
  company    text,
  role       text,
  where_met  text,
  notes      text,
  priority   text        not null default 'medium',

  -- Sorting by the priority text would order it alphabetically (high, low,
  -- medium), which is meaningless. This generated column gives Postgres a
  -- numeric rank to sort on, so "sort by priority" stays a server-side ORDER BY
  -- instead of a client-side re-shuffle. Always derived, never writable.
  priority_rank int generated always as (
    case priority when 'high' then 1 when 'medium' then 2 else 3 end
  ) stored,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Validation in trusted database code. These fire regardless of which
  -- client wrote the row.
  constraint contacts_name_not_blank check (length(btrim(name)) > 0),
  constraint contacts_name_max_len   check (length(name) <= 120),
  constraint contacts_priority_valid check (priority in ('high', 'medium', 'low')),
  constraint contacts_company_max_len   check (company   is null or length(company)   <= 120),
  constraint contacts_role_max_len      check (role      is null or length(role)      <= 120),
  constraint contacts_where_met_max_len check (where_met is null or length(where_met) <= 200),
  constraint contacts_notes_max_len     check (notes     is null or length(notes)     <= 2000)
);

-- Every query is "my contacts, sorted", so index the owner column.
create index if not exists contacts_user_id_idx on public.contacts (user_id);
create index if not exists contacts_user_id_created_at_idx on public.contacts (user_id, created_at desc);

-- ----------------------------------------------------------------------------
-- Keep updated_at honest
--
-- Set server-side so a client cannot backdate or freeze the timestamp.
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  -- A client must not be able to reassign ownership on update. The UPDATE
  -- policy's WITH CHECK already blocks this; pinning the old value here means
  -- the attempt fails closed rather than erroring.
  new.user_id = old.user_id;
  return new;
end;
$$;

drop trigger if exists contacts_set_updated_at on public.contacts;
create trigger contacts_set_updated_at
  before update on public.contacts
  for each row
  execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Row Level Security
--
-- FORCE applies the policies to the table owner too, so there is no role that
-- quietly sees everything.
-- ----------------------------------------------------------------------------
alter table public.contacts enable row level security;
alter table public.contacts force  row level security;

drop policy if exists contacts_select_own on public.contacts;
drop policy if exists contacts_insert_own on public.contacts;
drop policy if exists contacts_update_own on public.contacts;
drop policy if exists contacts_delete_own on public.contacts;

-- SELECT: you can only read rows you own.
create policy contacts_select_own
  on public.contacts
  for select
  to authenticated
  using (auth.user_id() = user_id);

-- INSERT: the row you write must be stamped with your own id. WITH CHECK runs
-- after the DEFAULT is applied, so sending someone else's user_id explicitly
-- is rejected rather than silently accepted.
create policy contacts_insert_own
  on public.contacts
  for insert
  to authenticated
  with check (auth.user_id() = user_id);

-- UPDATE: USING decides which rows you may target; WITH CHECK decides what the
-- row is allowed to look like afterwards. Both are required -- USING alone
-- would let you edit your own row into someone else's.
create policy contacts_update_own
  on public.contacts
  for update
  to authenticated
  using (auth.user_id() = user_id)
  with check (auth.user_id() = user_id);

-- DELETE: you can only delete rows you own.
create policy contacts_delete_own
  on public.contacts
  for delete
  to authenticated
  using (auth.user_id() = user_id);

-- ----------------------------------------------------------------------------
-- Grants
--
-- RLS filters rows; grants decide who may attempt a statement at all. Signed-in
-- users get CRUD (still filtered by the policies above). Anonymous callers get
-- nothing, so an unauthenticated request to the Data API cannot even reach the
-- table.
-- ----------------------------------------------------------------------------
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.contacts to authenticated;

-- Neon calls the unauthenticated Data API role "anonymous"; other PostgREST
-- stacks call it "anon". Revoke from whichever exists so a signed-out request
-- cannot reach the table at all.
do $$
declare
  role_name text;
begin
  foreach role_name in array array['anonymous', 'anon'] loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('revoke all on public.contacts from %I', role_name);
    end if;
  end loop;
end;
$$;

-- user_id, id, created_at and updated_at are all server-assigned. Removing
-- INSERT/UPDATE privileges on them means a client cannot even name those
-- columns in a write.
revoke insert (id, user_id, created_at, updated_at) on public.contacts from authenticated;
revoke update (id, user_id, created_at, updated_at) on public.contacts from authenticated;
