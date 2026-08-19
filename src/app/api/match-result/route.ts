import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'

export const dynamic = 'force-dynamic'

// Whether this participant ended up in a group after matching ran. There's
// no persisted "unmatched" record (the matching engine's unmatched list only
// ever lived in-memory / in the audit blob) — the only reliable signal is
// "do they have a group_members row," so that's what this checks.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const participantId = searchParams.get('participantId')

  if (!participantId) return NextResponse.json({ error: 'Missing participantId' }, { status: 400 })

  const supabase = createServiceRoleClient()
  const { data } = await supabase
    .from('group_members')
    .select('group_id')
    .eq('participant_id', participantId)
    .maybeSingle()

  return NextResponse.json({ matched: !!data, groupId: data?.group_id ?? null })
}
