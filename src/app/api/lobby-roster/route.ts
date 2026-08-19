import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

export const dynamic = 'force-dynamic'

// Returns the joined-order roster for the lobby's crew-assembly scene.
// event_participants + profiles are both publicly readable per RLS, so this
// carries no data the client couldn't already piece together — it's just a
// convenience join, same trust level as /api/lobby-summary's count.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const eventId = searchParams.get('eventId')

  if (!eventId) return NextResponse.json({ error: 'Missing eventId' }, { status: 400 })

  const supabase = createServiceRoleClient()
  const { data } = await supabase
    .from('event_participants')
    .select('id, department, joined_at, profiles(full_name)')
    .eq('event_id', eventId)
    .order('joined_at', { ascending: true })

  const roster = (data ?? []).map((row: any) => ({
    participantId: row.id as string,
    name: (row.profiles?.full_name as string | undefined) ?? 'Crew Member',
    department: row.department as string,
  }))

  return NextResponse.json({ roster })
}
