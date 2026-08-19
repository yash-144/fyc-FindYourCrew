# System Architecture

## Architecture Summary

The app uses Vercel and Supabase for the normal web application and persistent data, while Cloudflare Durable Objects handle the live realtime event experience.

```text
Student Browser
Admin Browser
    |
    | HTTPS
    v
Vercel / Next.js
    |
    | Auth + data
    v
Supabase Auth + Postgres

Student/Admin Browser
    |
    | WebSocket
    v
Cloudflare Worker
    |
    v
Cloudflare Durable Objects
```

## Components

### Next.js App

Responsibilities:

- Render student pages.
- Render admin pages.
- Handle Google auth callbacks through Supabase.
- Perform server-side validation.
- Read/write Supabase data.
- Invoke matching engine.
- Issue signed realtime access tokens for Cloudflare websocket connections.
- Provide polling fallback endpoints.

### Supabase

Responsibilities:

- Google OAuth identity.
- Permanent profile storage.
- Event participant storage.
- Questions/options.
- Responses.
- Metrics snapshots.
- Groups and memberships.
- Chat message persistence.
- Reports.
- Admin allowlist.

Supabase is the source of truth.

### Cloudflare Worker

Responsibilities:

- Accept websocket upgrade requests.
- Validate short-lived token from Next.js.
- Route connection to the correct Durable Object.
- Provide a small HTTP interface for server-originated event broadcasts if needed.

### Cloudflare Durable Objects

Responsibilities:

- Maintain live event room.
- Broadcast event state changes.
- Broadcast lobby count/reaction count changes.
- Maintain live group chat rooms.
- Fan out messages to connected clients.
- Use WebSocket hibernation where possible.

Durable Objects are not the permanent database.

## Realtime Objects

### EventRoom Durable Object

One object for the active induction event.

Handles:

- lobby count updates
- event state broadcast
- question lock broadcast
- metric publish broadcast
- lightweight reactions
- admin heartbeat

### GroupChat Durable Object

One object per generated group.

Handles:

- group member connections
- message fan-out
- typing indicator if added later
- reconnect-friendly recent message push

Messages are persisted through Next.js/Supabase, not only kept in the object.

## Data Flow: Answer Submission

1. User selects answer.
2. Client sends answer to Next.js API/server action.
3. Server validates event state and timer.
4. Server upserts response while question is unlocked.
5. Server returns accepted answer.
6. Client updates local selected state.

Realtime is not trusted for answer writes.

## Data Flow: Event State Change

1. Admin clicks action.
2. Next.js validates admin.
3. Supabase `event_state` is updated.
4. Next.js/Cloudflare publishes websocket broadcast.
5. Clients receive update.
6. Clients that miss broadcast catch up through polling or refetch.

## Data Flow: Chat Message

1. User sends message.
2. Client sends to Next.js API.
3. Server validates membership and group chat open state.
4. Server applies profanity censor and spam checks.
5. Server inserts message into Supabase.
6. Server publishes message to Cloudflare group room.
7. Connected group members receive message.
8. Disconnected users retrieve history from Supabase later.

## Security Boundaries

- Client cannot directly mutate critical event tables without server validation.
- Admin route requires authenticated user plus allowed email.
- Realtime connection requires signed, short-lived token.
- Realtime messages are treated as delivery events, not source-of-truth writes.
- Supabase Row Level Security should still be enabled where practical.

## Why Not Supabase Realtime For Everything

Supabase Free realtime has a 200 concurrent connection limit. The target is 700 to 1000 simultaneous users. Cloudflare Durable Objects provide a better free-first realtime path while keeping Supabase for auth and persistence.

## Deployment Targets

- App: Vercel.
- Database/Auth: Supabase.
- Realtime: Cloudflare Workers.
- Optional monitoring: Vercel logs, Supabase logs, Cloudflare logs.

