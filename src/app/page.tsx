import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { LoginForm } from '@/components/auth/login-form'
import { CrewmateIcon } from '@/components/ui/crewmate-icon'

export default async function Home() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user) {
    const { data: activeEvent } = await supabase
      .from('events')
      .select('id')
      .in('status', ['SETUP', 'LOBBY', 'COUNTDOWN', 'PRE_GAME', 'QUESTION_INTRO', 'QUESTION_ACTIVE', 'QUESTION_LOCKED', 'MATCHING'])
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (activeEvent) {
       const { data: participant } = await supabase
         .from('event_participants')
         .select('id, department, course')
         .eq('event_id', activeEvent.id)
         .eq('profile_id', user.id)
         .single()

       if (participant) {
         redirect('/lobby')
       } else {
         redirect('/profile')
       }
    } else {
      // If there's no active event, redirect to profile or a waiting page
      redirect('/profile')
    }
  }

  return (
    <main className="space-bg relative flex min-h-screen flex-col items-center justify-center p-6 overflow-hidden">
      {/* a few crewmates hanging around the hero, not perfectly arranged */}
      <div className="hidden sm:block absolute left-[8%] top-[22%] opacity-90" style={{ transform: 'rotate(-4deg)' }}>
        <CrewmateIcon color="cyan" size={64} />
      </div>
      <div className="hidden sm:block absolute right-[10%] top-[16%] opacity-90" style={{ transform: 'rotate(5deg)' }}>
        <CrewmateIcon color="yellow" size={52} />
      </div>
      <div className="hidden sm:block absolute right-[14%] bottom-[18%] opacity-90" style={{ transform: 'rotate(-3deg)' }}>
        <CrewmateIcon color="pink" size={58} />
      </div>
      <div className="hidden sm:block absolute left-[12%] bottom-[24%] opacity-90" style={{ transform: 'rotate(6deg)' }}>
        <CrewmateIcon color="green" size={46} />
      </div>

      <div className="relative z-10 w-full max-w-sm space-y-10 text-center">
        <div className="space-y-3">
          <div className="crew-label-red">Induction // Boarding</div>
          <h1 className="font-display font-black text-5xl sm:text-6xl tracking-tight text-starlight">
            FIND YOUR<br /><span className="text-red">CREW.</span>
          </h1>
          <p className="text-starlight-dim">
            Somewhere on this ship are your people. Complete a few tasks and we&rsquo;ll find them.
          </p>
        </div>

        <div className="panel-dark p-6">
          <LoginForm />
        </div>

        <p className="font-mono text-[0.65rem] tracking-wide text-starlight-dim leading-relaxed">
          We only use your basic Google info to get you set up.<br />
          Your privacy is important to us.
        </p>
      </div>
    </main>
  )
}
