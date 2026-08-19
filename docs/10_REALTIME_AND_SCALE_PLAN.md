# Realtime and Scale Plan

## Target

- Peak users: 700 to 1000 simultaneous students.
- Event duration: about one hour.
- State update target: around 1 second.
- Chat delivery target: around 1 second.
- Network quality: mixed Wi-Fi and mobile data.

## Locked Realtime Architecture

- Cloudflare Workers accept websocket connections.
- Cloudflare Durable Objects coordinate live event and group chat rooms.
- Supabase stores all permanent data.
- Vercel/Next.js validates critical writes and issues realtime tokens.
- Polling fallback exists for clients that cannot maintain WebSockets.

## Why This Architecture

Managed free realtime products usually cap free concurrent connections around 100 to 200. The event target is about 1000. Cloudflare Durable Objects are the best free-first option because they can coordinate many websocket clients and support websocket hibernation.

## Realtime Channels

### Event Room

One room per active event.

Messages:

- `event.state.changed`
- `lobby.count.changed`
- `reaction.count.changed`
- `question.locked`
- `metric.published`
- `matching.started`
- `matching.completed`
- `chat.opened`

### Group Room

One room per group.

Messages:

- `chat.message.created`
- `chat.report.created`, admin only if added later
- `group.info.updated`

## Client Reconnect Strategy

On socket disconnect:

1. Try reconnect with backoff.
2. Refetch event state from Next.js.
3. If reconnect fails repeatedly, switch to polling.
4. Continue polling until socket is healthy.

## Polling Fallback

Endpoints:

- `GET /api/event-state`
- `GET /api/lobby-summary`
- `GET /api/questions/current`
- `GET /api/groups/me`
- `GET /api/chat/:groupId/messages?after=...`

Suggested intervals:

- event state: 3 to 5 seconds
- lobby summary: 5 seconds
- chat: 2 to 4 seconds
- matching wait: 3 seconds

## Load Reduction Rules

- Do not stream individual answer events to every client.
- Compute metrics after question lock.
- Aggregate reactions before persistence.
- Broadcast small payloads only.
- Use one event websocket per client, not multiple sockets.
- Group chat socket opens only after matching.
- Avoid heavy presence tracking.
- Avoid per-user live cursor/typing in MVP.

## Write Path Rules

Critical writes go through Next.js:

- profile setup
- answer upsert
- admin event state changes
- matching invocation
- chat message persistence
- report creation

Cloudflare handles delivery, not authority.

## Free Tier Risk

Even with Cloudflare, free-tier systems have operational limits. The event should be rehearsed with realistic load.

Risks:

- Cloudflare free request/day limits.
- Vercel hobby function usage.
- Supabase free database and API limits.
- Supabase storage size over time.
- Weak network and device browser behavior.

## Load Test Plan

Simulate:

- 1000 lobby connections
- admin state broadcasts
- 1000 answer submissions within 45 seconds
- 1000 metric views
- matching with 1000 participants
- 250 groups of 4 chatting lightly
- report submission
- websocket reconnect storm

Pass criteria:

- no data loss for responses
- event state remains consistent
- answer submission success rate above 99%
- matching completes within target
- chat messages persist and deliver
- polling fallback works

## Official Limit Notes

Checked on 2026-08-18:

- Supabase Free realtime concurrent connections: 200.
- Ably Free concurrent connections: 200.
- Pusher Free concurrent connections: 100.
- Firebase Realtime Database Spark simultaneous connections: 100.
- Cloudflare Workers Free: 100,000 requests/day.
- Cloudflare Durable Objects support WebSocket hibernation and can coordinate many clients per object.

