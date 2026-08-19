'use server'

import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { redirect } from 'next/navigation'

export async function joinEvent(formData: FormData) {
  const department = formData.get('department') as string
  const course = formData.get('course') as string
  const phone_number = formData.get('phone_number') as string
  const eventId = formData.get('eventId') as string

  if (!department || !course || !eventId || !phone_number) {
    return { error: 'Missing required fields' }
  }

  if (!/^\+?[0-9\s\-().]{7,15}$/.test(phone_number)) {
    return { error: 'Please enter a valid phone number' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Not authenticated' }
  }

  // Email comes from the verified Google auth session — not from user input
  const email = user.email ?? null

  const adminClient = createServiceRoleClient()
  const { error } = await adminClient.from('event_participants').insert({
    event_id: eventId,
    profile_id: user.id,
    department,
    course,
    email,
    phone_number,
    status: 'JOINED'
  })

  if (error) {
    if (error.code === '23505') { // unique violation — already joined
       redirect('/lobby')
    }
    return { error: error.message }
  }

  redirect('/lobby')
}
