# Database Schema

This schema is designed for one active induction event, while preserving `event_id` so future events do not require a rewrite.

## Naming Conventions

- Primary keys use UUID.
- Timestamps use UTC `timestamptz`.
- Tables are plural.
- Foreign keys include `on delete cascade` only for event-scoped child data.
- Permanent user identity is not deleted when an event ends.

## Tables

### profiles

Permanent account record.

```sql
profiles (
  id uuid primary key references auth.users(id),
  email text not null unique,
  full_name text not null,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)
```

### admin_users

Allowed super admin emails.

```sql
admin_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
)
```

### events

Only one live event is expected now.

```sql
events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null,
  join_policy text not null default 'open',
  late_join_question_limit int not null default 2,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz
)
```

Allowed `events.status`:

- `SETUP`
- `LOBBY`
- `COUNTDOWN`
- `QUESTION_ACTIVE`
- `QUESTION_LOCKED`
- `METRIC_REVEAL`
- `MATCHING`
- `GROUP_CHAT_OPEN`
- `ENDED`

### event_state

Current event controller state. Kept separate for simple reads.

```sql
event_state (
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
)
```

### event_participants

Event-specific participant profile.

```sql
event_participants (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  profile_id uuid not null references profiles(id),
  department text not null,
  course text not null,
  status text not null default 'JOINED',
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz,
  unique(event_id, profile_id)
)
```

Allowed status:

- `JOINED`
- `ACTIVE`
- `LATE`
- `MATCHABLE`
- `UNMATCHED`
- `MATCHED`
- `REMOVED`

### questions

Admin-fed event questions.

```sql
questions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  position int not null,
  title text,
  body text not null,
  timer_seconds int not null default 45,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(event_id, position)
)
```

### question_options

```sql
question_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references questions(id) on delete cascade,
  option_key text not null,
  label text not null,
  metric_label text,
  matching_value jsonb,
  unique(question_id, option_key)
)
```

`option_key` is usually `A`, `B`, `C`, `D`.

### responses

Editable until timer lock.

```sql
responses (
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
)
```

Allowed `response_status`:

- `ANSWERED`
- `MISSED`
- `LATE_REJECTED`

### question_metrics

```sql
question_metrics (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  question_id uuid not null references questions(id) on delete cascade,
  metric_type text not null,
  title text not null,
  body text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
)
```

### live_reaction_counts

Aggregated reaction counters, not every tap unless needed.

```sql
live_reaction_counts (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  scope text not null,
  reaction_key text not null,
  count int not null default 0,
  updated_at timestamptz not null default now(),
  unique(event_id, scope, reaction_key)
)
```

### groups

```sql
groups (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  code text not null,
  name text not null,
  icebreaker_prompt text,
  matching_audit jsonb,
  created_at timestamptz not null default now(),
  unique(event_id, code)
)
```

### group_members

```sql
group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references groups(id) on delete cascade,
  participant_id uuid not null references event_participants(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(group_id, participant_id)
)
```

### chat_messages

```sql
chat_messages (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  group_id uuid not null references groups(id) on delete cascade,
  sender_participant_id uuid not null references event_participants(id),
  raw_text text not null,
  censored_text text not null,
  moderation_status text not null default 'CLEAN',
  created_at timestamptz not null default now()
)
```

Allowed `moderation_status`:

- `CLEAN`
- `CENSORED`
- `FLAGGED`
- `BLOCKED`

### chat_reports

```sql
chat_reports (
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
)
```

### moderation_terms

```sql
moderation_terms (
  id uuid primary key default gen_random_uuid(),
  term text not null unique,
  severity text not null default 'CENSOR',
  replacement text not null default '****',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
)
```

## Required Indexes

```sql
create index idx_event_participants_event on event_participants(event_id);
create index idx_responses_event_question on responses(event_id, question_id);
create index idx_responses_participant on responses(participant_id);
create index idx_groups_event on groups(event_id);
create index idx_group_members_group on group_members(group_id);
create index idx_group_members_participant on group_members(participant_id);
create index idx_chat_messages_group_time on chat_messages(group_id, created_at);
create index idx_chat_reports_status on chat_reports(event_id, status);
```

## RLS Direction

Enable RLS for all public tables.

Students can:

- read own profile
- read own event participant row
- read active event/question data
- insert/update own responses while server permits
- read own group and group members
- read/send messages only in own group after chat opens
- create reports in own group

Admins can:

- read/write all event data if email is active in `admin_users`

Server-side API should still validate all critical writes even with RLS enabled.

