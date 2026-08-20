'use server'

import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath, refresh } from 'next/cache'
import { executeMatchingWorkflow } from './matching/workflow'

// revalidatePath invalidates Next's cache for other/future requests, but the
// admin who *just* clicked Advance needs their own already-rendered view to
// pick up the change too — that's what `refresh()` is for (it re-fetches the
// current route's RSC payload for the caller specifically). Without it, the
// admin panel would silently keep showing the pre-click state until a manual
// reload, even though the DB and every other client are already correct.

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data: admin } = await supabase
    .from('admin_users')
    .select('id')
    .eq('email', user.email)
    .maybeSingle()
  
  if (!admin) throw new Error('Not authorized')
  return user
}

export async function createEvent(name: string) {
  await requireAdmin()
  const supabase = createServiceRoleClient()

  const { data, error } = await supabase.from('events').insert({
    name,
    status: 'LOBBY'
  }).select('id').single()

  if (error) throw error

  await supabase.from('event_state').insert({
    event_id: data.id,
    status: 'LOBBY'
  })

  // Add dummy questions for local testing
  const q1 = await supabase.from('questions').insert({ event_id: data.id, position: 1, title: 'Icebreaker', body: 'What is your favorite weekend activity?', timer_seconds: 30 }).select('id').single()
  if (q1.data?.id) {
    await supabase.from('question_options').insert([
      { question_id: q1.data.id, option_key: 'A', label: 'Reading' },
      { question_id: q1.data.id, option_key: 'B', label: 'Gaming' },
      { question_id: q1.data.id, option_key: 'C', label: 'Outdoors' },
      { question_id: q1.data.id, option_key: 'D', label: 'Sleeping' },
    ])
  }

  revalidatePath('/admin')
  refresh()
  return data
}

// Returns the updated event_state row so the caller can broadcast it
// directly over the realtime worker — every connected participant reacts to
// that one broadcast by hitting /api/event-state simultaneously (see
// use-realtime.ts), so pushing the actual row avoids turning one admin click
// into hundreds of synchronized HTTP requests.
export async function updateEventStatus(eventId: string, status: string) {
  await requireAdmin()
  const supabase = createServiceRoleClient()

  if (status === 'MATCHING') {
     // Perform matching workflow before updating status
     await executeMatchingWorkflow(eventId)
  }

  await supabase.from('events').update({ status }).eq('id', eventId)
  const { data: eventState } = await supabase.from('event_state').update({ status }).eq('event_id', eventId).select().single()

  revalidatePath('/admin')
  refresh()
  return eventState
}

export async function updateQuestionStatus(eventId: string, questionId: string | null, status: string, durationSeconds?: number) {
  await requireAdmin()
  const supabase = createServiceRoleClient()

  // Transitioning to Locked marks missed answers
  if (status === 'QUESTION_LOCKED' && questionId) {
     const { data: participants } = await supabase.from('event_participants').select('id').eq('event_id', eventId).in('status', ['JOINED', 'ACTIVE'])
     const { data: answered } = await supabase.from('responses').select('participant_id').eq('event_id', eventId).eq('question_id', questionId)
     
     const answeredSet = new Set(answered?.map(a => a.participant_id) || [])
     const missing = participants?.filter(p => !answeredSet.has(p.id)) || []

     if (missing.length > 0) {
       await supabase.from('responses').insert(missing.map(m => ({
         event_id: eventId,
         question_id: questionId,
         participant_id: m.id,
         response_status: 'MISSED',
         locked_at: new Date().toISOString()
       })))
     }
  }

  await supabase.from('events').update({ status }).eq('id', eventId)
  
  const stateUpdate: any = { status }
  if (questionId) stateUpdate.active_question_id = questionId
  if (durationSeconds) {
    stateUpdate.timer_duration_seconds = durationSeconds
    stateUpdate.timer_started_at = new Date().toISOString()
  }

  const { data: eventState } = await supabase.from('event_state').update(stateUpdate).eq('event_id', eventId).select().single()

  revalidatePath('/admin')
  refresh()
  return eventState
}

// --- Reset ("kill button") ---
//
// Before a real run, an admin who's been iterating/testing the same event
// wants everyone's join/answers/matches/chat wiped so it starts clean — this
// is exactly the class of bug this session kept hitting (stale participants
// still showing in the lobby, a stale group colliding with a fresh matching
// run). Deliberately does NOT touch questions/question_options — those are
// authored setup, not run data, and an admin who just wrote a quiz shouldn't
// lose it to a "clean slate" click. Cascades handle the rest: deleting
// event_participants cascades responses; deleting groups cascades
// group_members/chat_messages/chat_reports.

export async function getResetPreview(eventId: string) {
  await requireAdmin()
  const supabase = createServiceRoleClient()

  const [participants, responses, groups, chatMessages] = await Promise.all([
    supabase.from('event_participants').select('id', { count: 'exact', head: true }).eq('event_id', eventId),
    supabase.from('responses').select('id', { count: 'exact', head: true }).eq('event_id', eventId),
    supabase.from('groups').select('id', { count: 'exact', head: true }).eq('event_id', eventId),
    supabase.from('chat_messages').select('id', { count: 'exact', head: true }).eq('event_id', eventId),
  ])

  return {
    participants: participants.count || 0,
    responses: responses.count || 0,
    groups: groups.count || 0,
    chatMessages: chatMessages.count || 0,
  }
}

export async function resetEventData(eventId: string) {
  await requireAdmin()
  const supabase = createServiceRoleClient()

  // groups first — its cascade takes group_members/chat_messages/chat_reports
  // with it. event_participants next — its cascade takes responses with it.
  await supabase.from('groups').delete().eq('event_id', eventId)
  await supabase.from('event_participants').delete().eq('event_id', eventId)
  // Dead tables from the removed metric-reveal feature — cleared defensively
  // in case any rows survive from before that feature was removed.
  await supabase.from('question_metrics').delete().eq('event_id', eventId)
  await supabase.from('live_reaction_counts').delete().eq('event_id', eventId)

  await supabase.from('events').update({ status: 'LOBBY', started_at: null, ended_at: null }).eq('id', eventId)
  const { data: eventState } = await supabase
    .from('event_state')
    .update({
      status: 'LOBBY',
      active_question_id: null,
      question_index: null,
      timer_started_at: null,
      timer_duration_seconds: null,
      timer_paused_at: null,
      timer_remaining_seconds: null,
      metric_id: null,
    })
    .eq('event_id', eventId)
    .select()
    .single()

  revalidatePath('/admin')
  refresh()
  return eventState
}

// --- Question Management CRUD ---

export async function createQuestion(
  eventId: string,
  questionData: { title: string; body: string; timer_seconds: number },
  options: { option_key: string; label: string }[]
) {
  await requireAdmin()
  const supabase = createServiceRoleClient()

  // Get current max position
  const { data: maxPosData } = await supabase
    .from('questions')
    .select('position')
    .eq('event_id', eventId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()
  
  const nextPosition = (maxPosData?.position || 0) + 1

  const { data: q, error: qError } = await supabase
    .from('questions')
    .insert({
      event_id: eventId,
      position: nextPosition,
      ...questionData,
      is_active: true
    })
    .select('id')
    .single()

  if (qError) throw qError

  if (options.length > 0) {
    const optionsToInsert = options.map(opt => ({
      question_id: q.id,
      ...opt
    }))
    const { error: optError } = await supabase.from('question_options').insert(optionsToInsert)
    if (optError) throw optError
  }

  revalidatePath('/admin')
  refresh()
  return q
}

export async function updateQuestion(
  questionId: string,
  questionData: { title: string; body: string; timer_seconds: number },
  options: { id?: string; option_key: string; label: string }[]
) {
  await requireAdmin()
  const supabase = createServiceRoleClient()

  const { error: qError } = await supabase
    .from('questions')
    .update(questionData)
    .eq('id', questionId)

  if (qError) throw qError

  // For options, simple approach: delete all existing and re-insert 
  // (Assuming we don't care about preserving option IDs if they change, but responses link to option_id)
  // Wait, if we delete options, it might break foreign keys in `responses` if this question has been answered!
  // Since it's pre-planned, they probably haven't been answered. But to be safe, we should upsert.

  for (const opt of options) {
    if (opt.id) {
      await supabase.from('question_options').update({
        option_key: opt.option_key,
        label: opt.label
      }).eq('id', opt.id)
    } else {
      await supabase.from('question_options').insert({
        question_id: questionId,
        option_key: opt.option_key,
        label: opt.label
      })
    }
  }

  // Find options that are in DB but not in the new options array, and delete them
  if (options.length > 0) {
    const keepIds = options.filter(o => o.id).map(o => o.id)
    if (keepIds.length > 0) {
      await supabase.from('question_options')
        .delete()
        .eq('question_id', questionId)
        .not('id', 'in', `(${keepIds.join(',')})`)
    }
  }

  revalidatePath('/admin')
  refresh()
}

export async function deleteQuestion(questionId: string) {
  await requireAdmin()
  const supabase = createServiceRoleClient()

  // question_options has a foreign key to questions. It should cascade if setup correctly,
  // but if not, we delete options first just in case.
  await supabase.from('question_options').delete().eq('question_id', questionId)
  
  const { error } = await supabase.from('questions').delete().eq('id', questionId)
  if (error) throw error

  revalidatePath('/admin')
  refresh()
}

export async function reorderQuestions(eventId: string, questionIdsInOrder: string[]) {
  await requireAdmin()
  const supabase = createServiceRoleClient()

  // Update position for each question
  for (let i = 0; i < questionIdsInOrder.length; i++) {
    await supabase
      .from('questions')
      .update({ position: i + 1 })
      .eq('id', questionIdsInOrder[i])
      .eq('event_id', eventId)
  }

  revalidatePath('/admin')
  refresh()
}
