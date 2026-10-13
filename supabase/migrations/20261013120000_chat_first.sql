-- Fluxo chat-first: a viagem nasce vazia e é preenchida pela conversa.

alter table trips alter column destination drop not null;
alter table trips add column travel_party text;                      -- "casal", "família com 2 crianças"...
alter table trips add column interests text[] not null default '{}'; -- o que a pessoa procura

create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips (id) on delete cascade,
  user_id uuid references profiles (id) on delete set null,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index chat_messages_trip_idx on chat_messages (trip_id, created_at);

alter table chat_messages enable row level security;

create policy chat_select on chat_messages for select using (is_trip_member(trip_id));
create policy chat_insert on chat_messages for insert with check (can_edit_trip(trip_id));
