import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const eventId = searchParams.get('eventId')

  if (!eventId) return NextResponse.json({ error: 'Missing eventId' }, { status: 400 })

  const supabase = createServiceRoleClient()
  const { data } = await supabase
    .from('event_state')
    .select('*')
    .eq('event_id', eventId)
    .single()

  return NextResponse.json(data || null)
}
