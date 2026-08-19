import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

export const dynamic = 'force-dynamic'

// Just the count, for the task-list HUD (which only needs "N of M"). The
// individual question body is still fetched separately via /api/question so
// nothing about locked/future questions leaks early.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const eventId = searchParams.get('eventId')

  if (!eventId) return NextResponse.json({ error: 'Missing eventId' }, { status: 400 })

  const supabase = createServiceRoleClient()
  const { count } = await supabase
    .from('questions')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', eventId)

  return NextResponse.json({ total: count || 0 })
}
