/**
 * A light, baseline hard-block list — deliberately separate from the
 * admin-configurable `moderation_terms` table (src/server/moderation.ts),
 * which censors-and-flags but still sends. This list instead blocks the
 * message from sending at all. Kept intentionally small ("light checks" per
 * the ask) rather than an exhaustive slur database.
 *
 * Used both client-side (instant feedback before a network round-trip) and
 * server-side (the enforcement that actually matters — a client check alone
 * is trivially bypassed).
 */
const BLOCKED_TERMS = [
  'fuck', 'shit', 'bitch', 'asshole', 'bastard', 'cunt', 'dick', 'piss',
  'slut', 'whore', 'nigger', 'nigga', 'faggot', 'retard', 'rape',
]

const BLOCKED_PATTERN = new RegExp(`\\b(${BLOCKED_TERMS.join('|')})\\b`, 'i')

export function containsBlockedWord(text: string): boolean {
  return BLOCKED_PATTERN.test(text)
}
