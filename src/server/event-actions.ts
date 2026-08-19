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
    status: 'SETUP'
  }).select('id').single()

  if (error) throw error

  await supabase.from('event_state').insert({
    event_id: data.id,
    status: 'SETUP'
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

export async function updateEventStatus(eventId: string, status: string) {
  await requireAdmin()
  const supabase = createServiceRoleClient()

  if (status === 'MATCHING') {
     // Perform matching workflow before updating status
     await executeMatchingWorkflow(eventId)
  }

  await supabase.from('events').update({ status }).eq('id', eventId)
  await supabase.from('event_state').update({ status }).eq('event_id', eventId)
  
  revalidatePath('/admin')
  refresh()
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

  await supabase.from('event_state').update(stateUpdate).eq('event_id', eventId)
  
  revalidatePath('/admin')
  refresh()
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
