import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ProfileForm } from '@/components/profile/profile-form'
import { CrewHeader } from '@/components/ui/crew-header'
import { CrewmateIcon } from '@/components/ui/crewmate-icon'
import { crewColorForId } from '@/lib/crew-color'
import { getViewerProfile } from '@/lib/get-viewer-profile'

export default async function ProfilePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/')
  }

  const { fullName } = await getViewerProfile(supabase, user.id)

  // Check if they already joined the active event
  const { data: activeEvent } = await supabase
    .from('events')
    .select('id')
    .in('status', ['SETUP', 'LOBBY', 'COUNTDOWN', 'PRE_GAME', 'QUESTION_INTRO', 'QUESTION_ACTIVE', 'QUESTION_LOCKED', 'MATCHING'])
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (!activeEvent) {
    return (
      <main className="space-bg flex min-h-screen flex-col">
        <CrewHeader eyebrow="Status: Idle" title="Find Your Crew" id={user.id} name={fullName} email={user.email} />
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <div className="crew-label-red mb-2">No Signal</div>
          <h1 className="font-display font-bold text-2xl text-starlight">No Active Event</h1>
          <p className="text-starlight-dim mt-2">There is currently no active event to join.</p>
        </div>
      </main>
    )
  }

  const { data: participant } = await supabase
    .from('event_participants')
    .select('id')
    .eq('event_id', activeEvent.id)
    .eq('profile_id', user.id)
    .single()

  if (participant) {
    redirect('/lobby')
  }

  const color = crewColorForId(user.id)

  return (
    <main className="space-bg flex min-h-screen flex-col">
      <CrewHeader eyebrow="Crew Prep" title="Find Your Crew" id={user.id} name={fullName} email={user.email} />
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="drop-shadow-[0_8px_20px_rgba(0,0,0,0.4)]">
              <CrewmateIcon color={color} size={92} />
            </div>
            <h1 className="font-display font-bold text-3xl tracking-tight text-starlight">That&rsquo;s you.</h1>
            <p className="text-starlight-dim">
              A few details before you board.
            </p>
          </div>

          <div className="panel-dark p-6">
            <ProfileForm eventId={activeEvent.id} userEmail={user!.email ?? ''} />
          </div>
        </div>
      </div>
    </main>
  )
}
