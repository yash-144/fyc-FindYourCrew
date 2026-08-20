# Load testing

Two real bottlenecks this app can actually hit at 500 concurrent users, and
scripts for each:

1. **HTTP thundering herd** (`http-load.js`, k6) — every admin "Advance"
   click broadcasts one WS message, and every connected client reacts by
   simultaneously calling `/api/event-state`, `/api/questions-meta`,
   `/api/question`, and `/api/realtime/auth`. With 500 people in one event
   that's ~2000 requests landing in the same instant, roughly a dozen times
   over the life of an event.
2. **Realtime worker join burst / roster fan-out** (`ws-load.mjs`, plain
   Node + `ws`) — all 500 lobby WebSocket connections for one event share a
   single Durable Object. The roster-broadcast fix sends the full roster to
   every open socket on every join, so a join burst is up to O(n²) sends in
   the worst case. This is the newest code in the stack and the thing worth
   trusting least without a real number behind it.

Both point at **a throwaway event created for the test**, never a real one —
`provision-users.mjs` creates it, `cleanup-users.mjs` tears it down.

## Setup

```bash
cd loadtest
npm install --no-save @supabase/supabase-js   # if not already present

# Create N synthetic users + a throwaway event. Do this once per test run.
NODE_OPTIONS=--experimental-websocket node provision-users.mjs 500
```

This writes `loadtest/.out/session.json` — every session, the throwaway
event/question id, everything the two test scripts need. It's gitignored;
delete it (or just rerun cleanup) between runs.

## Run

```bash
# HTTP thundering-herd test against the deployed app.
# VUS defaults to however many users you provisioned.
APP_BASE_URL=https://fyc-srmuh.vercel.app VUS=500 BURSTS=5 k6 run http-load.js

# Realtime worker join-burst test.
# args: [count] [joinWindowMs] [holdMs]
NODE_OPTIONS=--experimental-websocket node ws-load.mjs 500 60000 30000
```

Start small first (e.g. `provision-users.mjs 20`, `VUS=20`,
`ws-load.mjs 20`) to sanity-check the whole pipeline before committing to a
500-user run — creating 500 synthetic accounts and pushing that much load at
once is itself a real event against production Supabase/Cloudflare, with
real cost and rate-limit implications.

## Cleanup

```bash
NODE_OPTIONS=--experimental-websocket node cleanup-users.mjs
```

Deletes the synthetic users and the throwaway event (groups/chat/questions
cascade with it). Safe to re-run.

## Reading the results

- `http-load.js` thresholds fail the run if `http_req_failed` rate exceeds
  1% or any route's p95 exceeds 800ms — tune both once you have a baseline.
- `ws-load.mjs` prints connect success rate, time-to-first-roster-broadcast
  (p50/p95), whether every client actually converged on the full roster, and
  socket error/unexpected-close counts. A join burst that leaves clients with
  a stale roster, or takes seconds to converge at 500 users, is the specific
  failure mode this script exists to catch.
