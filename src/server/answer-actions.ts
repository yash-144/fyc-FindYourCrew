'use server'

import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

export async function submitResponse(eventId: string, questionId: string, optionId: string) {
  const supabaseAuth = await createClient()
  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const supabaseAdmin = createServiceRoleClient()

  const { data: participant } = await supabaseAdmin.from('event_participants').select('id').eq('profile_id', user.id).eq('event_id', eventId).single()
  if (!participant) throw new Error('Not joined')

  // Make sure question is still active
  const { data: state } = await supabaseAdmin.from('event_state').select('status, active_question_id').eq('event_id', eventId).single()
  if (state?.status !== 'QUESTION_ACTIVE' || state?.active_question_id !== questionId) {
    throw new Error('Question is not active')
  }

  // Upsert response
  const { data: existing } = await supabaseAdmin.from('responses').select('id').eq('participant_id', participant.id).eq('question_id', questionId).single()
  
  if (existing) {
    await supabaseAdmin.from('responses').update({ option_id: optionId, response_status: 'ANSWERED', updated_at: new Date().toISOString() }).eq('id', existing.id)
  } else {
    await supabaseAdmin.from('responses').insert({
      event_id: eventId,
      question_id: questionId,
      participant_id: participant.id,
      option_id: optionId,
      response_status: 'ANSWERED',
      first_answered_at: new Date().toISOString()
    })
  }
}
