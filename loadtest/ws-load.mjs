// Stress-tests the part of the stack I'd trust least under real concurrency:
// the realtime worker's EventRoom Durable Object, specifically the
// roster-broadcast fan-out added for the "stale lobby members" fix. All 500
// participants for one event share a single DO instance, and every `join`
// broadcasts the full roster to every currently-open socket — so a join
// burst is O(n) sends per join, up to O(n^2) in the worst case.
//
// This script:
//   1. Opens N real WebSocket connections to one throwaway event, staggered
//      over a configurable window (a real join burst isn't instantaneous).
//   2. Each client sends `join` with a distinct participantId/name, then
//      pings every 25s like the real client (see use-realtime.ts).
//   3. Measures: connect success rate, time from join to first roster
//      broadcast, whether every client's roster eventually converges to the
//      full N, and process RSS as a rough proxy for how the harness itself
//      (not the worker) is coping.
//   4. After a hold period, disconnects everyone at once and confirms the
//      worker's close-driven roster broadcasts don't fall over either.
//
// Requires loadtest/.out/session.json (run provision-users.mjs first).
//
// Usage:
//   NODE_OPTIONS=--experimental-websocket node loadtest/ws-load.mjs [count] [joinWindowMs]

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const manifest = JSON.parse(readFileSync(path.join(__dirname, '.out', 'session.json'), 'utf8'))

const REALTIME_URL = process.env.REALTIME_URL || 'wss://crew-match-realtime.goyalyash144.workers.dev'
const COUNT = Number(process.argv[2] || manifest.users.length)
const JOIN_WINDOW_MS = Number(process.argv[3] || 60_000) // spread joins over this window, like people trickling into a lobby
const HOLD_MS = Number(process.argv[4] || 30_000) // how long everyone stays connected before mass-disconnect

if (COUNT > manifest.users.length) {
  console.error(`Requested ${COUNT} but only ${manifest.users.length} synthetic users were provisioned. Re-run provision-users.mjs with a higher count.`)
  process.exit(1)
}

const eventId = manifest.eventId
console.log(`[ws-load] target=${REALTIME_URL} event=${eventId} count=${COUNT} joinWindow=${JOIN_WINDOW_MS}ms hold=${HOLD_MS}ms`)

let connected = 0
let joinSent = 0
let firstRosterAt = new Map() // participantId -> ms since script start
let lastRosterSize = new Map() // participantId -> last roster length it saw
let errors = 0
let closedUnexpectedly = 0
const t0 = Date.now()

function connectOne(user, i) {
  return new Promise((resolve) => {
    const url = new URL(`${REALTIME_URL}/ws/event/${eventId}`)
    url.searchParams.set('eventId', eventId)
    url.searchParams.set('token', user.accessToken)
    const ws = new WebSocket(url)
    let pinger = null

    ws.onopen = () => {
      connected += 1
      ws.send(JSON.stringify({ type: 'join', participantId: user.authId, name: user.name }))
      joinSent += 1
      pinger = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }))
      }, 25_000)
      resolve({ ws, pinger, user, i })
    }
    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        if (data.type === 'roster') {
          if (!firstRosterAt.has(user.authId)) firstRosterAt.set(user.authId, Date.now() - t0)
          lastRosterSize.set(user.authId, data.payload.length)
        }
      } catch (_) {}
    }
    ws.onerror = () => { errors += 1 }
    ws.onclose = (e) => {
      if (pinger) clearInterval(pinger)
      if (e.code !== 1000) closedUnexpectedly += 1
    }
  })
}

async function main() {
  const users = manifest.users.slice(0, COUNT)
  const staggerMs = COUNT > 1 ? JOIN_WINDOW_MS / COUNT : 0
  const clients = []

  console.log(`[ws-load] connecting ${COUNT} clients, staggered ~${staggerMs.toFixed(0)}ms apart...`)
  for (let i = 0; i < users.length; i += 1) {
    clients.push(connectOne(users[i], i))
    if (staggerMs > 0) await new Promise((r) => setTimeout(r, staggerMs))
    if ((i + 1) % 50 === 0) console.log(`[ws-load]   ${i + 1}/${COUNT} join messages sent (t=${((Date.now() - t0) / 1000).toFixed(1)}s)`)
  }

  const settled = await Promise.all(clients)
  console.log(`[ws-load] all connect attempts issued. connected=${connected}/${COUNT} errors=${errors}`)

  // Give the last joiner's roster broadcast time to reach everyone.
  await new Promise((r) => setTimeout(r, 5_000))

  const converged = [...lastRosterSize.values()].filter((n) => n === connected).length
  const rosterTimes = [...firstRosterAt.values()].sort((a, b) => a - b)
  const p50 = rosterTimes[Math.floor(rosterTimes.length * 0.5)] || 0
  const p95 = rosterTimes[Math.floor(rosterTimes.length * 0.95)] || 0
  const mem = process.memoryUsage()

  console.log('\n[ws-load] === JOIN BURST RESULTS ===')
  console.log(`  connected:            ${connected}/${COUNT}`)
  console.log(`  join messages sent:   ${joinSent}`)
  console.log(`  clients converged to full roster (${connected}): ${converged}/${connected}`)
  console.log(`  time-to-first-roster: p50=${p50}ms p95=${p95}ms`)
  console.log(`  socket errors:        ${errors}`)
  console.log(`  harness RSS:          ${(mem.rss / 1024 / 1024).toFixed(0)}MB`)

  console.log(`\n[ws-load] holding for ${HOLD_MS}ms (steady-state, pings only)...`)
  await new Promise((r) => setTimeout(r, HOLD_MS))

  console.log('[ws-load] mass-disconnecting all clients at once...')
  const disconnectStart = Date.now()
  for (const c of settled) {
    if (c.pinger) clearInterval(c.pinger)
    try { c.ws.close(1000, 'load test done') } catch (_) {}
  }
  await new Promise((r) => setTimeout(r, 5_000))
  console.log(`[ws-load] mass-disconnect issued in ${Date.now() - disconnectStart}ms`)
  console.log(`[ws-load] unexpected closes during the run: ${closedUnexpectedly}`)
  console.log('[ws-load] done.')
}

main().catch((err) => {
  console.error('[ws-load] FAILED:', err)
  process.exitCode = 1
})
