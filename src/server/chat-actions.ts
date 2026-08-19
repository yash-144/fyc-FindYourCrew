'use server'

import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { applyModeration } from './moderation'
import { containsBlockedWord } from '@/lib/blocklist'

export async function submitChatMessage(eventId: string, groupId: string, text: string) {
  // Hard block: never persisted, never broadcast — checked before anything
  // else touches the message. Distinct from applyModeration below, which
  // censors admin-configured terms but still sends the (censored) message.
  if (containsBlockedWord(text)) {
    throw new Error('Message blocked: please keep it respectful.')
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data: participant } = await supabase.from('event_participants').select('id').eq('profile_id', user.id).eq('event_id', eventId).single()
  if (!participant) throw new Error('Not joined')

  // Apply moderation
  const { censoredText, status } = await applyModeration(text)

  // Persist
  const { data, error } = await supabase.from('chat_messages').insert({
    event_id: eventId,
    group_id: groupId,
    sender_participant_id: participant.id,
    raw_text: text,
    censored_text: censoredText,
    moderation_status: status
  }).select('id, censored_text, created_at').single()

  if (error) throw error

  return { ...data, sender_participant_id: participant.id }
}

const REPORT_REASONS = ['Inappropriate language', 'Harassment', 'Spam', 'Other'] as const
export type ReportReason = (typeof REPORT_REASONS)[number]

export async function reportMessage({
  eventId,
  groupId,
  messageId,
  reportedParticipantId,
  reason,
  messageText,
}: {
  eventId: string
  groupId: string
  messageId: string | null
  reportedParticipantId: string
  reason: ReportReason
  messageText: string
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  // Verify the reporter is actually a member of this group before writing
  // anything with the service-role client (which bypasses RLS).
  const { data: participant } = await supabase
    .from('event_participants')
    .select('id')
    .eq('profile_id', user.id)
    .eq('event_id', eventId)
    .single()
  if (!participant) throw new Error('Not joined')

  // Service-role, not the session client: group_members' own SELECT policy
  // still has the pending infinite-recursion issue from earlier (fix
  // written but not yet applied in the dashboard) — this check doesn't need
  // to depend on that being fixed first.
  const admin = createServiceRoleClient()
  const { data: membership } = await admin
    .from('group_members')
    .select('id')
    .eq('group_id', groupId)
    .eq('participant_id', participant.id)
    .maybeSingle()
  if (!membership) throw new Error('Not a member of this crew')

  const { error } = await admin.from('chat_reports').insert({
    event_id: eventId,
    group_id: groupId,
    message_id: messageId,
    reporter_participant_id: participant.id,
    reported_participant_id: reportedParticipantId,
    reason,
    context_snapshot: { message_text: messageText, reason, reported_at: new Date().toISOString() },
  })
  if (error) throw error

  return { ok: true }
}
