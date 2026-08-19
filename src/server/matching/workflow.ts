import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { runMatching, validateMatchingOutput } from './index'
import type { MatchingInput, MatchingParticipant, MatchingQuestion, MatchingResponse, MatchingOption } from './index'

export async function executeMatchingWorkflow(eventId: string) {
  const supabase = createServiceRoleClient()

  // 1. Fetch participants
  const { data: participantsRaw, error: pErr } = await supabase
    .from('event_participants')
    .select('*, profiles(full_name)')
    .eq('event_id', eventId)
  
  if (pErr) throw pErr

  const participants: MatchingParticipant[] = participantsRaw.map((p: any) => ({
    participantId: p.id,
    profileId: p.profile_id,
    fullName: p.profiles?.full_name || 'Unknown',
    department: p.department,
    course: p.course,
    joinedAt: p.joined_at,
    status: (p.status === 'JOINED' || p.status === 'ACTIVE') ? 'MATCHABLE' : p.status
  }))

  // 2. Fetch questions
  const { data: questionsRaw, error: qErr } = await supabase
    .from('questions')
    .select('*')
    .eq('event_id', eventId)
    .order('position', { ascending: true })

  if (qErr) throw qErr

  const questions: MatchingQuestion[] = questionsRaw.map((q: any) => ({
    questionId: q.id,
    position: q.position,
    weight: 1
  }))

  // 3. Fetch options
  const { data: optionsRaw, error: oErr } = await supabase
    .from('question_options')
    .select('*, questions!inner(event_id)')
    .eq('questions.event_id', eventId)
  
  if (oErr) throw oErr

  const options: MatchingOption[] = optionsRaw.map((o: any) => ({
    optionId: o.id,
    questionId: o.question_id,
    optionKey: o.option_key,
    matchingValue: o.matching_value
  }))

  // 4. Fetch responses
  const { data: responsesRaw, error: rErr } = await supabase
    .from('responses')
    .select('*')
    .eq('event_id', eventId)

  if (rErr) throw rErr

  const responses: MatchingResponse[] = responsesRaw.map((r: any) => ({
    participantId: r.participant_id,
    questionId: r.question_id,
    optionId: r.option_id,
    status: r.response_status === 'ANSWERED' ? 'ANSWERED' : 'MISSED',
    updatedAt: r.updated_at
  }))

  const seed = eventId + "-" + Date.now()

  // Fewer than 2 participants can't form a real group: `planGroupSizes`
  // requires minSize >= 2, and even with a valid policy, a count below
  // minSize doesn't fail the algorithm — it just plans zero groups and
  // dumps everyone into `unmatched` as overflow, so `runMatching` reports
  // success with nothing persisted and the participant is stuck forever.
  // Handle the trivial cases directly instead of asking the algorithm to.
  if (participants.length === 0) {
    return
  }

  if (participants.length === 1) {
    const solo = participants[0]
    const { error: rpcErr } = await supabase.rpc('persist_matching_results', {
      p_event_id: eventId,
      p_groups: [{
        code: 'SOLO-1',
        name: 'Solo Crew',
        icebreaker_prompt: null,
        member_participant_ids: [solo.participantId]
      }],
      p_audit: {
        eventId,
        seed,
        participantCount: 1,
        reason: 'solo_participant_bypassed_algorithm'
      }
    })
    if (rpcErr) throw rpcErr
    return
  }

  // Build input
  const input: MatchingInput = {
    eventId,
    seed,
    groupSizePolicy: {
      mode: "flexible",
      // Clamp minSize down to the participant count for small events so a
      // single real group forms instead of everyone landing in overflow.
      minSize: Math.min(4, participants.length),
      maxSize: 6
    },
    participants,
    questions,
    responses,
    options
  }

  // 5. Run Matching
  const output = await runMatching(input)
  if (!output.success) {
     throw new Error(`Matching failed: ${output.error}`)
  }

  // 6. Validate
  const validationResult = validateMatchingOutput(output, participants.map(p => p.participantId))
  if (!validationResult.ok) {
     throw new Error(`Matching validation failed: ${validationResult.error}`)
  }

  // 7. Persist via RPC
  const groupsPayload = output.groups.map(g => ({
    code: g.code,
    name: g.name,
    icebreaker_prompt: g.icebreakerPrompt,
    member_participant_ids: g.memberParticipantIds
  }))

  const { error: rpcErr } = await supabase.rpc('persist_matching_results', {
    p_event_id: eventId,
    p_groups: groupsPayload,
    p_audit: output.audit
  })

  if (rpcErr) throw rpcErr

  return output
}
