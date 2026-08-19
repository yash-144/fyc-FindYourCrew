-- Initial Schema for Appirates Crew Match

-- Tables

create table if not exists profiles (
  id uuid primary key references auth.users(id),
  email text not null unique,
  full_name text not null,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists admin_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null,
  join_policy text not null default 'open',
  late_join_question_limit int not null default 2,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz
);

create table if not exists event_state (
  event_id uuid primary key references events(id),
  status text not null,
  active_question_id uuid,
  question_index int,
  timer_started_at timestamptz,
  timer_duration_seconds int,
  timer_paused_at timestamptz,
  timer_remaining_seconds int,
  metric_id uuid,
  updated_at timestamptz not null default now()
);

create table if not exists event_participants (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  profile_id uuid not null references profiles(id),
  department text not null,
  course text not null,
  status text not null default 'JOINED',
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz,
  unique(event_id, profile_id)
);

create table if not exists questions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  position int not null,
  title text,
  body text not null,
  timer_seconds int not null default 45,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(event_id, position)
);

create table if not exists question_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references questions(id) on delete cascade,
  option_key text not null,
  label text not null,
  metric_label text,
  matching_value jsonb,
  unique(question_id, option_key)
);

create table if not exists responses (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  question_id uuid not null references questions(id) on delete cascade,
  participant_id uuid not null references event_participants(id) on delete cascade,
  option_id uuid references question_options(id),
  response_status text not null default 'ANSWERED',
  first_answered_at timestamptz,
  updated_at timestamptz not null default now(),
  locked_at timestamptz,
  unique(event_id, question_id, participant_id)
);

create table if not exists question_metrics (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  question_id uuid not null references questions(id) on delete cascade,
  metric_type text not null,
  title text not null,
  body text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists live_reaction_counts (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  scope text not null,
  reaction_key text not null,
  count int not null default 0,
  updated_at timestamptz not null default now(),
  unique(event_id, scope, reaction_key)
);

create table if not exists groups (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  code text not null,
  name text not null,
  icebreaker_prompt text,
  matching_audit jsonb,
  created_at timestamptz not null default now(),
  unique(event_id, code)
);

create table if not exists group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  participant_id uuid not null references event_participants(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(group_id, participant_id)
);

create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  group_id uuid not null references groups(id) on delete cascade,
  sender_participant_id uuid not null references event_participants(id),
  raw_text text not null,
  censored_text text not null,
  moderation_status text not null default 'CLEAN',
  created_at timestamptz not null default now()
);

create table if not exists chat_reports (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  group_id uuid not null references groups(id) on delete cascade,
  message_id uuid references chat_messages(id),
  reporter_participant_id uuid not null references event_participants(id),
  reported_participant_id uuid references event_participants(id),
  reason text,
  context_snapshot jsonb not null,
  status text not null default 'OPEN',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create table if not exists moderation_terms (
  id uuid primary key default gen_random_uuid(),
  term text not null unique,
  severity text not null default 'CENSOR',
  replacement text not null default '****',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Required Indexes
create index if not exists idx_event_participants_event on event_participants(event_id);
create index if not exists idx_responses_event_question on responses(event_id, question_id);
create index if not exists idx_responses_participant on responses(participant_id);
create index if not exists idx_groups_event on groups(event_id);
create index if not exists idx_group_members_group on group_members(group_id);
create index if not exists idx_group_members_participant on group_members(participant_id);
create index if not exists idx_chat_messages_group_time on chat_messages(group_id, created_at);
create index if not exists idx_chat_reports_status on chat_reports(event_id, status);

-- Enable Row Level Security
alter table profiles enable row level security;
alter table admin_users enable row level security;
alter table events enable row level security;
alter table event_state enable row level security;
alter table event_participants enable row level security;
alter table questions enable row level security;
alter table question_options enable row level security;
alter table responses enable row level security;
alter table question_metrics enable row level security;
alter table live_reaction_counts enable row level security;
alter table groups enable row level security;
alter table group_members enable row level security;
alter table chat_messages enable row level security;
alter table chat_reports enable row level security;
alter table moderation_terms enable row level security;

-- Setup basic RLS rules allowing service_role (server) full access. 
-- For a Next.js App Router setup with Supabase, most writes will be via server actions using standard or service role clients.
-- Clients only need to read public event info and their own participant info.

create policy "Public read profiles" on profiles for select using (true);
create policy "Users can update own profile" on profiles for update using (auth.uid() = id);

create policy "Public read events" on events for select using (true);
create policy "Public read event_state" on event_state for select using (true);

create policy "Users can read event_participants" on event_participants for select using (true);
create policy "Users can read active questions" on questions for select using (is_active = true);
create policy "Users can read question options" on question_options for select using (true);

create policy "Users can read own responses" on responses for select using (
  participant_id in (select id from event_participants where profile_id = auth.uid())
);
-- Write is handled strictly by the server.

create policy "Public read question metrics" on question_metrics for select using (true);
create policy "Public read live reaction counts" on live_reaction_counts for select using (true);

create policy "Users can read own group members" on group_members for select using (
  participant_id in (select id from event_participants where profile_id = auth.uid())
  or group_id in (select group_id from group_members where participant_id in (select id from event_participants where profile_id = auth.uid()))
);

create policy "Users can read own group" on groups for select using (
  id in (select group_id from group_members where participant_id in (select id from event_participants where profile_id = auth.uid()))
);

create policy "Users can read messages in their group" on chat_messages for select using (
  group_id in (select group_id from group_members where participant_id in (select id from event_participants where profile_id = auth.uid()))
);

create policy "Users can insert messages into their group" on chat_messages for insert with check (
  group_id in (select group_id from group_members where participant_id in (select id from event_participants where profile_id = auth.uid()))
  and sender_participant_id in (select id from event_participants where profile_id = auth.uid())
);

-- Admin superuser policy template (simplified, server side will use service role anyway)
create policy "Admins can do everything" on events for all using (
  exists (select 1 from admin_users where email = auth.jwt()->>'email' and is_active = true)
);

-- Handle profile creation on signup
create or replace function public.handle_new_user() 
returns trigger as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id, 
    new.email, 
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', 'Unknown'), 
    coalesce(new.raw_user_meta_data->>'avatar_url', new.raw_user_meta_data->>'picture')
  );
  return new;
end;
$$ language plpgsql security definer;

-- Trigger to call handle_new_user when a user is created
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
