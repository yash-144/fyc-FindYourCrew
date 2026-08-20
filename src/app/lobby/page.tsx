import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { LobbyClient } from '@/components/lobby/lobby-client'
import { getViewerProfile } from '@/lib/get-viewer-profile'

export default async function LobbyPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/')

  const { fullName, avatarUrl } = await getViewerProfile(supabase, user.id)

  // Verify participant
  const { data: participant } = await supabase
    .from('event_participants')
    .select('id, event_id, events(status)')
    .eq('profile_id', user.id)
    .order('joined_at', { ascending: false })
    .limit(1)
    .single()

  if (!participant) {
    redirect('/profile')
  }

  const eventStatus = (participant.events as any).status

  if (eventStatus !== 'LOBBY' && eventStatus !== 'SETUP' && eventStatus !== 'COUNTDOWN') {
    // Everything past the lobby — including GROUP_CHAT_OPEN — funnels through
    // /event, which is the single place that decides whether a participant
    // was matched (and only then sends them on to /chat).
    redirect('/event')
  }

  // The lobby is its own scene (a dark crew-assembly room) rather than the
  // paper/ink chrome the rest of the app uses — it owns its full viewport,
  // including a minimal self-styled corner control instead of AppHeader.
  return (
    <LobbyClient
      eventId={participant.event_id}
      selfParticipantId={participant.id}
      selfName={fullName}
      selfAvatarUrl={avatarUrl}
    />
  )
}
