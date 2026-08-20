// k6 script for the app's actual thundering-herd risk: every time the admin
// advances the event, all connected participants react to one WS broadcast
// by simultaneously hitting these same four routes (see event-client.tsx and
// use-realtime.ts). This script reproduces that burst directly, repeated a
// few times with gaps, rather than a generic ramp — that's the real shape of
// the load this app produces.
//
// Requires loadtest/.out/session.json (run provision-users.mjs first).
//
// Usage:
//   APP_BASE_URL=https://your-app.vercel.app VUS=20 k6 run loadtest/http-load.js
//
// VUS should be <= the count passed to provision-users.mjs (sessions are
// reused round-robin otherwise, which is fine for load shape but means
// fewer distinct identities than VUs).

import http from 'k6/http'
import { check, sleep } from 'k6'

const manifest = JSON.parse(open('./.out/session.json'))
const APP_BASE_URL = __ENV.APP_BASE_URL
if (!APP_BASE_URL) {
  throw new Error('Set APP_BASE_URL, e.g. APP_BASE_URL=https://your-app.vercel.app k6 run loadtest/http-load.js')
}

const VUS = Number(__ENV.VUS || manifest.users.length)
// How many "admin advance" bursts to simulate in one run, with a quiet gap
// between them — an event does ~13 advances (LOBBY -> PRE_GAME -> 5x(INTRO
// -> ACTIVE -> LOCKED) -> MATCHING -> GROUP_CHAT_OPEN), so a handful of
// bursts is a representative sample without needing a 20-minute run.
const BURSTS = Number(__ENV.BURSTS || 5)
const GAP_SECONDS = Number(__ENV.GAP_SECONDS || 15)

export const options = {
  scenarios: {
    advance_burst: {
      executor: 'per-vu-iterations',
      vus: VUS,
      iterations: BURSTS,
      maxDuration: `${BURSTS * (GAP_SECONDS + 10)}s`,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{route:event-state}': ['p(95)<800'],
    'http_req_duration{route:question}': ['p(95)<800'],
    'http_req_duration{route:questions-meta}': ['p(95)<800'],
    'http_req_duration{route:realtime-auth}': ['p(95)<800'],
  },
}

export default function () {
  const user = manifest.users[(__VU - 1) % manifest.users.length]
  const cookieHeader = `${manifest.cookieName}=${user.cookieValue}`
  const authedParams = { headers: { Cookie: cookieHeader } }

  // Everyone reacts to the same event_state_update broadcast at once —
  // this is the actual burst shape, not a ramp.
  const responses = http.batch([
    ['GET', `${APP_BASE_URL}/api/event-state?eventId=${manifest.eventId}`, null, { tags: { route: 'event-state' } }],
    ['GET', `${APP_BASE_URL}/api/questions-meta?eventId=${manifest.eventId}`, null, { tags: { route: 'questions-meta' } }],
    ['GET', `${APP_BASE_URL}/api/question?id=${manifest.questionId}`, null, { ...authedParams, tags: { route: 'question' } }],
    ['GET', `${APP_BASE_URL}/api/realtime/auth`, null, { ...authedParams, tags: { route: 'realtime-auth' } }],
  ])

  check(responses[0], { 'event-state 200': (r) => r.status === 200 })
  check(responses[1], { 'questions-meta 200': (r) => r.status === 200 })
  check(responses[2], { 'question 200': (r) => r.status === 200 })
  check(responses[3], { 'realtime-auth 200': (r) => r.status === 200 })

  if (__ENV.DEBUG_FAILURES) {
    for (const r of responses) {
      if (r.status !== 200) {
        console.log(`FAIL ${r.request.method} ${r.request.url} -> status=${r.status} error=${r.error} body=${(r.body || '').slice(0, 200)}`)
      }
    }
  }

  sleep(GAP_SECONDS)
}
