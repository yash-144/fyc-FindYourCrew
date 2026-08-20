// Creates N throwaway synthetic accounts (real Supabase Auth users, real
// sessions) plus one throwaway event to point load tests at, and writes
// everything both k6 and the WS harness need into loadtest/.out/session.json.
//
// Deliberately mirrors the synthetic-account pattern used by every test
// script elsewhere in this repo's history: *.test.invalid emails, real
// admin.auth.admin.createUser() + signInWithPassword(), cleaned up by
// cleanup-users.mjs afterward. Nothing here touches a real event or a real
// user.
//
// Usage:
//   NODE_OPTIONS=--experimental-websocket node loadtest/provision-users.mjs [count]
//
// Reads Supabase credentials from .env.local (same file the app itself uses).

import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const OUT_DIR = path.join(__dirname, '.out')

function loadEnvLocal() {
  const text = readFileSync(path.join(REPO_ROOT, '.env.local'), 'utf8')
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx === -1) continue
    process.env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim()
  }
}
loadEnvLocal()

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const PROJECT_REF = new URL(SUPABASE_URL).hostname.split('.')[0]
const COOKIE_NAME = `sb-${PROJECT_REF}-auth-token`

const COUNT = Number(process.argv[2] || 20)
const RUN_TAG = `loadtest-${Date.now()}`
// Throttle account creation — Supabase's Auth admin API rate-limits bursts.
const CREATE_CONCURRENCY = 8

const admin = createClient(SUPABASE_URL, SERVICE_KEY)

function b64url(s) {
  return Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function createOneUser(i) {
  const email = `${RUN_TAG}-u${i}@test.invalid`
  const password = `Test-${RUN_TAG}-${i}!`
  const { data: userData, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { full_name: `LoadTest ${i}` },
  })
  if (error) throw new Error(`createUser ${i} failed: ${error.message}`)
  return { index: i, authId: userData.user.id, email, password, name: `LoadTest ${i}` }
}

// signInWithPassword shares GoTrue's sign-in rate limit bucket, which is far
// stingier than the admin createUser endpoint — bursting it concurrently
// reliably fails around the same count regardless of concurrency, so this
// runs strictly sequentially with backoff-on-429 rather than through the
// same worker pool used for account creation.
async function signInOne(u) {
  const anon = createClient(SUPABASE_URL, ANON_KEY)
  let delay = 2000
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const { data: session, error } = await anon.auth.signInWithPassword({ email: u.email, password: u.password })
    if (!error) {
      return {
        ...u,
        accessToken: session.session.access_token,
        cookieValue: 'base64-' + b64url(JSON.stringify(session.session)),
      }
    }
    const isRateLimit = /rate limit/i.test(error.message)
    if (!isRateLimit || attempt === 5) throw new Error(`signIn ${u.index} failed: ${error.message}`)
    console.log(`[provision]   rate-limited signing in user ${u.index}, retrying in ${delay / 1000}s (attempt ${attempt + 1}/6)...`)
    await new Promise((r) => setTimeout(r, delay))
    delay = Math.min(delay * 2, 30_000)
  }
}

async function pool(items, worker, concurrency) {
  const results = new Array(items.length)
  let next = 0
  async function runOne() {
    while (next < items.length) {
      const i = next++
      results[i] = await worker(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: concurrency }, runOne))
  return results
}

async function main() {
  console.log(`[provision] creating ${COUNT} synthetic users (tag=${RUN_TAG})...`)
  const indices = Array.from({ length: COUNT }, (_, i) => i)
  const created = await pool(indices, createOneUser, CREATE_CONCURRENCY)
  console.log(`[provision] ${created.length} accounts created, signing in sequentially...`)

  const users = []
  for (const u of created) {
    users.push(await signInOne(u))
    if (users.length % 20 === 0) console.log(`[provision]   ${users.length}/${created.length} signed in`)
  }
  console.log(`[provision] ${users.length} users created and signed in`)

  console.log('[provision] creating throwaway event + a couple of questions...')
  const { data: event, error: eventErr } = await admin.from('events').insert({
    name: `Load Test ${RUN_TAG}`,
    status: 'QUESTION_ACTIVE',
  }).select('id').single()
  if (eventErr) throw eventErr

  const { data: q1, error: qErr } = await admin.from('questions').insert({
    event_id: event.id, position: 1, title: 'Load test question',
    body: 'This is a synthetic question used only for load testing.',
    timer_seconds: 30,
  }).select('id').single()
  if (qErr) throw qErr

  await admin.from('question_options').insert([
    { question_id: q1.id, option_key: 'A', label: 'Option A' },
    { question_id: q1.id, option_key: 'B', label: 'Option B' },
    { question_id: q1.id, option_key: 'C', label: 'Option C' },
  ])

  await admin.from('event_state').insert({
    event_id: event.id,
    status: 'QUESTION_ACTIVE',
    active_question_id: q1.id,
    timer_started_at: new Date().toISOString(),
    timer_duration_seconds: 30,
  })

  mkdirSync(OUT_DIR, { recursive: true })
  const manifest = {
    runTag: RUN_TAG,
    createdAt: new Date().toISOString(),
    supabaseUrl: SUPABASE_URL,
    cookieName: COOKIE_NAME,
    eventId: event.id,
    questionId: q1.id,
    users,
  }
  writeFileSync(path.join(OUT_DIR, 'session.json'), JSON.stringify(manifest, null, 2))
  console.log(`[provision] wrote ${path.join(OUT_DIR, 'session.json')}`)
  console.log(`[provision] eventId=${event.id} questionId=${q1.id}`)
  console.log('[provision] done. Run cleanup-users.mjs when you are finished testing.')
}

main().catch((err) => {
  console.error('[provision] FAILED:', err)
  process.exitCode = 1
})
