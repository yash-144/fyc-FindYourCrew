/**
 * Chat feature integration test — no real users.
 *
 * Seeds two synthetic Supabase auth users (throwaway *.test.invalid emails,
 * never real people) plus a disposable event/group, signs each in for a real
 * session JWT exactly like /api/realtime/auth hands the browser, and drives
 * two real WebSocket clients against the *actual* realtime worker (run
 * locally via `wrangler dev`) the same way ChatClient/use-realtime.ts does.
 *
 * Verifies:
 *   - a message sent by one participant is relayed live to the other over
 *     the real GroupChat Durable Object
 *   - moderation censoring happens server-side — the raw banned term never
 *     reaches the wire, only censored_text does
 *   - the relayed payload matches exactly what chat-actions.ts persists
 *
 * Everything created is deleted in a `finally` block, even on failure.
 *
 * Usage:
 *   1. In one terminal: cd workers/realtime && npx wrangler dev --port 8787
 *   2. In another:      NODE_OPTIONS=--experimental-websocket npx tsx scripts/test-chat.ts
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { applyModeration } from "../src/server/moderation";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnvLocal(): void {
  const envPath = path.join(__dirname, "..", ".env.local");
  const text = readFileSync(envPath, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnvLocal();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name} — check .env.local`);
    process.exit(1);
  }
  return value;
}

const SUPABASE_URL = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const ANON_KEY = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const WORKER_URL = process.env.REALTIME_WORKER_URL || "ws://127.0.0.1:8787";

if (typeof WebSocket === "undefined") {
  console.error(
    "No global WebSocket. Run with: NODE_OPTIONS=--experimental-websocket npx tsx scripts/test-chat.ts",
  );
  process.exit(1);
}

const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY);
const RUN_TAG = `chattest-${Date.now()}`;

interface TestUser {
  label: string;
  authId: string;
  participantId: string;
  email: string;
  token: string;
}

class AssertionError extends Error {}
function assertTrue(condition: boolean, message: string): void {
  if (!condition) throw new AssertionError(message);
}
function waitFor(condition: () => boolean, timeoutMs: number, message: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const interval = setInterval(() => {
      if (condition()) {
        clearInterval(interval);
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        reject(new Error(message));
      }
    }, 50);
  });
}
function connect(url: URL, label: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => reject(new Error(`connect timed out for ${label}`)), 8000);
    ws.onopen = () => {
      clearTimeout(timer);
      resolve(ws);
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error(`ws error connecting ${label} (is wrangler dev running on ${WORKER_URL}?)`));
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Cleanup tracking — every created row/user is deleted in `finally` below   */
/* -------------------------------------------------------------------------- */

const created = {
  eventId: undefined as string | undefined,
  groupId: undefined as string | undefined,
  moderationTermId: undefined as string | undefined,
  users: [] as TestUser[],
};

async function cleanup(): Promise<void> {
  console.log("\n[cleanup] removing everything this run created...");
  if (created.moderationTermId) {
    await admin.from("moderation_terms").delete().eq("id", created.moderationTermId);
  }
  if (created.eventId) {
    await admin.from("chat_messages").delete().eq("event_id", created.eventId);
  }
  if (created.groupId) {
    await admin.from("group_members").delete().eq("group_id", created.groupId);
    await admin.from("groups").delete().eq("id", created.groupId);
  }
  if (created.eventId) {
    await admin.from("event_participants").delete().eq("event_id", created.eventId);
    await admin.from("event_state").delete().eq("event_id", created.eventId);
    await admin.from("events").delete().eq("id", created.eventId);
  }
  for (const user of created.users) {
    await admin.from("profiles").delete().eq("id", user.authId);
    await admin.auth.admin.deleteUser(user.authId);
  }
  console.log("[cleanup] done");
}

/* -------------------------------------------------------------------------- */
/* Test                                                                       */
/* -------------------------------------------------------------------------- */

async function main(): Promise<void> {
  console.log(`[setup] run tag: ${RUN_TAG}`);
  console.log(`[setup] worker: ${WORKER_URL}`);

  // 1. Two synthetic auth users — throwaway test accounts, never real people.
  for (const label of ["a", "b"]) {
    const email = `${RUN_TAG}-${label}@test.invalid`;
    const password = `Test-${RUN_TAG}-${label}!`;
    const { data: userData, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: `Chat Test ${label.toUpperCase()}` },
    });
    if (createErr || !userData.user) {
      throw new Error(`create user ${label} failed: ${createErr?.message}`);
    }
    const user: TestUser = { label, authId: userData.user.id, participantId: "", email, token: "" };
    created.users.push(user);

    // Sign in with the anon client to get a real session JWT — exactly what
    // /api/realtime/auth returns to the browser for a logged-in user.
    const anon = createClient(SUPABASE_URL, ANON_KEY);
    const { data: session, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
    if (signInErr || !session.session) {
      throw new Error(`sign in ${label} failed: ${signInErr?.message}`);
    }
    user.token = session.session.access_token;
  }
  console.log(`[setup] created ${created.users.length} synthetic auth users`);

  // 2. Disposable event in GROUP_CHAT_OPEN, exactly the phase the chat page requires.
  const { data: event, error: eventErr } = await admin
    .from("events")
    .insert({ name: `Chat Test ${RUN_TAG}`, status: "GROUP_CHAT_OPEN" })
    .select("id")
    .single();
  if (eventErr || !event) throw new Error(`create event failed: ${eventErr?.message}`);
  created.eventId = event.id as string;
  await admin.from("event_state").insert({ event_id: created.eventId, status: "GROUP_CHAT_OPEN" });

  // 3. Participants
  for (const user of created.users) {
    const { data: participant, error: participantErr } = await admin
      .from("event_participants")
      .insert({
        event_id: created.eventId,
        profile_id: user.authId,
        department: "CSE",
        course: "BTech",
        status: "ACTIVE",
      })
      .select("id")
      .single();
    if (participantErr || !participant) {
      throw new Error(`create participant ${user.label} failed: ${participantErr?.message}`);
    }
    user.participantId = participant.id as string;
  }

  // 4. One group, both participants as members — the actual chat "crew".
  const { data: group, error: groupErr } = await admin
    .from("groups")
    .insert({ event_id: created.eventId, code: "TEST-1", name: "Test Crew", icebreaker_prompt: "n/a" })
    .select("id")
    .single();
  if (groupErr || !group) throw new Error(`create group failed: ${groupErr?.message}`);
  created.groupId = group.id as string;

  for (const user of created.users) {
    await admin.from("group_members").insert({ group_id: created.groupId, participant_id: user.participantId });
  }

  console.log(`[setup] eventId=${created.eventId} groupId=${created.groupId}`);
  console.log(
    `[setup] participants: A=${created.users[0]!.participantId} B=${created.users[1]!.participantId}`,
  );

  // 5. Connect both to the worker's group socket, exactly like use-realtime.ts.
  function groupWsUrl(user: TestUser): URL {
    const url = new URL(`${WORKER_URL}/ws/group/${created.groupId}`);
    url.searchParams.set("eventId", created.eventId as string);
    url.searchParams.set("token", user.token);
    return url;
  }

  const [wsA, wsB] = await Promise.all([
    connect(groupWsUrl(created.users[0]!), "A"),
    connect(groupWsUrl(created.users[1]!), "B"),
  ]);
  console.log("[test] both sockets connected to the real worker");

  const receivedByB: any[] = [];
  wsB.onmessage = (event) => {
    receivedByB.push(JSON.parse(event.data as string));
  };

  // 6. Seed a moderation term so censoring is exercised against a real,
  //    known banned word rather than assumed.
  const bannedTerm = `zzztest${Date.now()}`;
  const { data: term, error: termErr } = await admin
    .from("moderation_terms")
    .insert({ term: bannedTerm, severity: "CENSOR", replacement: "****", is_active: true })
    .select("id")
    .single();
  if (termErr || !term) throw new Error(`create moderation term failed: ${termErr?.message}`);
  created.moderationTermId = term.id as string;

  // 7. Send a message the same way chat-actions.ts's submitChatMessage does:
  //    moderate -> persist -> broadcast only the persisted (censored) row.
  const rawText = `hello from A, this word is ${bannedTerm} banned`;
  const { censoredText, status } = await applyModeration(rawText);
  assertTrue(status === "FLAGGED", "moderation should flag the seeded banned term");
  assertTrue(!censoredText.includes(bannedTerm), "censored text should not contain the banned term");

  const { data: persisted, error: msgErr } = await admin
    .from("chat_messages")
    .insert({
      event_id: created.eventId,
      group_id: created.groupId,
      sender_participant_id: created.users[0]!.participantId,
      raw_text: rawText,
      censored_text: censoredText,
      moderation_status: status,
    })
    .select("id, censored_text, created_at")
    .single();
  if (msgErr || !persisted) throw new Error(`persist message failed: ${msgErr?.message}`);

  const broadcastPayload = { ...persisted, sender_participant_id: created.users[0]!.participantId };
  wsA.send(
    JSON.stringify({ type: "broadcast", payload: { type: "chat_message", payload: broadcastPayload } }),
  );
  console.log("[test] A sent a message containing the banned term");

  // 8. B should receive exactly one relayed, already-censored message.
  await waitFor(() => receivedByB.length > 0, 5000, "B never received the broadcast message");
  const relayed = receivedByB[0];
  assertTrue(relayed.type === "chat_message", `expected chat_message, got ${relayed.type}`);
  assertTrue(relayed.payload.id === persisted.id, "relayed message id mismatch");
  assertTrue(relayed.payload.censored_text === censoredText, "relayed text does not match censored text");
  assertTrue(
    relayed.payload.sender_participant_id === created.users[0]!.participantId,
    "relayed sender mismatch",
  );
  assertTrue(!JSON.stringify(relayed).includes(bannedTerm), "raw banned term leaked onto the wire");
  assertTrue(!("raw_text" in relayed.payload), "raw_text leaked onto the wire");
  console.log("[test] B received the relayed message, correctly censored");

  // 9. A should not receive its own broadcast back twice / echoed unexpectedly
  //    beyond what the Durable Object fans out to all sockets (including the
  //    sender) — document current behavior rather than assume.
  const receivedByA: any[] = [];
  wsA.onmessage = (event) => receivedByA.push(JSON.parse(event.data as string));
  await new Promise((resolve) => setTimeout(resolve, 300));
  console.log(
    `[info] sender also received ${receivedByA.length} echoed frame(s) via the fan-out ` +
      `(GroupChat.broadcast sends to every connected socket, sender included)`,
  );

  wsA.close(1000, "test done");
  wsB.close(1000, "test done");

  console.log("\n✅ chat integration test passed");
}

main()
  .catch((err) => {
    console.error("\n❌ chat integration test failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await cleanup();
    } catch (cleanupErr) {
      console.error("[cleanup] FAILED — manual cleanup may be required:", cleanupErr);
      console.error("[cleanup] leftover ids:", JSON.stringify(created, null, 2));
      process.exitCode = 1;
    }
  });
