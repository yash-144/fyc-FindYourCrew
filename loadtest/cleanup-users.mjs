// Tears down everything provision-users.mjs created: the synthetic auth
// users/profiles and the throwaway event (questions/options/event_state
// cascade or are deleted explicitly). Safe to re-run — skips anything
// already gone.
//
// Usage:
//   NODE_OPTIONS=--experimental-websocket node loadtest/cleanup-users.mjs

import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const MANIFEST_PATH = path.join(__dirname, '.out', 'session.json')

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

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function main() {
  if (!existsSync(MANIFEST_PATH)) {
    console.log('[cleanup] no session.json found — nothing to clean up')
    return
  }
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
  console.log(`[cleanup] tearing down run ${manifest.runTag} (${manifest.users.length} users, event ${manifest.eventId})`)

  if (manifest.eventId) {
    await admin.from('event_participants').delete().eq('event_id', manifest.eventId)
    await admin.from('responses').delete().eq('event_id', manifest.eventId)
    const { data: questions } = await admin.from('questions').select('id').eq('event_id', manifest.eventId)
    for (const q of questions || []) {
      await admin.from('question_options').delete().eq('question_id', q.id)
    }
    await admin.from('questions').delete().eq('event_id', manifest.eventId)
    await admin.from('event_state').delete().eq('event_id', manifest.eventId)
    await admin.from('groups').delete().eq('event_id', manifest.eventId) // cascades group_members/chat_messages/chat_reports
    await admin.from('events').delete().eq('id', manifest.eventId)
    console.log('[cleanup] throwaway event removed')
  }

  // `profiles.id references auth.users(id)` with no ON DELETE CASCADE, and
  // an on_auth_user_created trigger auto-creates a profiles row for every
  // synthetic user the moment it's created. Deleting the auth user before
  // its profiles row is gone violates that FK and deleteUser fails with a
  // generic 500 ("Database error deleting user") — profiles must go first.
  // Also retry each failure a couple of times with a short backoff since
  // hundreds of sequential admin API calls can transient-fail under rate
  // limiting.
  let deleted = 0
  const stillFailed = []
  for (const u of manifest.users) {
    let ok = false
    for (let attempt = 0; attempt < 3 && !ok; attempt += 1) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 500 * attempt))
      await admin.from('profiles').delete().eq('id', u.authId)
      const { error } = await admin.auth.admin.deleteUser(u.authId)
      if (!error) { ok = true; deleted += 1 }
      else if (attempt === 2) { console.error(`[cleanup] failed to delete ${u.email}: ${error.message}`); stillFailed.push(u.email) }
    }
  }
  console.log(`[cleanup] deleted ${deleted}/${manifest.users.length} synthetic users`)
  if (stillFailed.length > 0) {
    console.error(`[cleanup] ${stillFailed.length} user(s) could not be deleted after retries: ${stillFailed.join(', ')}`)
    console.error('[cleanup] re-run this script to retry them — session.json is kept on disk since not everything was cleaned up.')
    return
  }

  unlinkSync(MANIFEST_PATH)
  console.log('[cleanup] done')
}

main().catch((err) => {
  console.error('[cleanup] FAILED (partial cleanup may have happened):', err)
  process.exitCode = 1
})
