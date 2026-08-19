import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const eventId = searchParams.get('eventId')

  if (!eventId) return NextResponse.json({ error: 'Missing eventId' }, { status: 400 })

  const supabase = createServiceRoleClient()
  const { count } = await supabase
    .from('event_participants')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', eventId)

  return NextResponse.json({ count: count || 0 })
}
