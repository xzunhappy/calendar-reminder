create table if not exists public.calendar_events (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  data jsonb,
  deleted_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.calendar_events enable row level security;

drop policy if exists "calendar_events_select_own" on public.calendar_events;
drop policy if exists "calendar_events_insert_own" on public.calendar_events;
drop policy if exists "calendar_events_update_own" on public.calendar_events;
drop policy if exists "calendar_events_delete_own" on public.calendar_events;

create policy "calendar_events_select_own"
on public.calendar_events for select
using (auth.uid() = user_id);

create policy "calendar_events_insert_own"
on public.calendar_events for insert
with check (auth.uid() = user_id);

create policy "calendar_events_update_own"
on public.calendar_events for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "calendar_events_delete_own"
on public.calendar_events for delete
using (auth.uid() = user_id);
