import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { EventClient } from '@/components/event/event-client'
import { CrewHeader } from '@/components/ui/crew-header'
import { getViewerProfile } from '@/lib/get-viewer-profile'

export default async function EventPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/')

  const { fullName } = await getViewerProfile(supabase, user.id)

  // Verify participant
  const { data: participant } = await supabase
    .from('event_participants')
    .select('id, event_id, events(status)')
    .eq('profile_id', user.id)
    .single()

  if (!participant) redirect('/profile')

  const eventStatus = (participant.events as any).status

  if (eventStatus === 'SETUP' || eventStatus === 'LOBBY') {
    redirect('/lobby')
  }

  // GROUP_CHAT_OPEN is deliberately NOT redirected here — EventClient checks
  // whether this participant actually has a group first, and shows an
  // ejected/crew-found reveal before ever sending a matched participant on
  // to /chat. A blanket server redirect would skip that and, for anyone who
  // didn't get matched, dead-end them on a bare "not in a group" page.

  return (
    <main className="space-bg flex min-h-screen flex-col">
      <CrewHeader eyebrow="Live Signal" title="Find Your Crew" id={user.id} name={fullName} email={user.email} />
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <EventClient eventId={participant.event_id} participantId={participant.id} />
      </div>
    </main>
  )
}
