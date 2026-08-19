import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { AdminClient } from '@/components/admin/admin-client'
import { AppHeader } from '@/components/ui/app-header'
import { getViewerProfile } from '@/lib/get-viewer-profile'
import { createEvent } from '@/server/event-actions'

export default async function AdminPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) notFound()

  const { data: admin, error } = await supabase.from('admin_users').select('id, is_active').eq('email', user.email).maybeSingle()
  if (!admin || !admin.is_active) notFound()

  const { fullName } = await getViewerProfile(supabase, user.id)

  // Get active event or create one
  const { data: events } = await supabase.from('events').select('*').order('created_at', { ascending: false }).limit(1)
  let activeEvent = events?.[0]

  if (!activeEvent) {
    return (
      <main className="min-h-screen flex flex-col">
        <AppHeader eyebrow="Mission Control" title="Admin" id={user.id} name={fullName} email={user.email} />
        <div className="flex-1 flex items-center justify-center p-6 text-center">
          <div className="field-card p-8 space-y-4">
            <h1 className="font-display font-bold text-xl text-ink">No Event Yet</h1>
            <form action={async () => {
              'use server'
              await createEvent('Find Your Crew Initial Event')
            }}>
              <button className="btn-primary px-6 py-3">Create First Event</button>
            </form>
          </div>
        </div>
      </main>
    )
  }

  const { data: eventState } = await supabase.from('event_state').select('*').eq('event_id', activeEvent.id).maybeSingle()
  const { data: questions } = await supabase
    .from('questions')
    .select('*, options:question_options(*)')
    .eq('event_id', activeEvent.id)
    .order('position', { ascending: true })

  return (
    <main className="min-h-screen flex flex-col">
      <AppHeader eyebrow="Mission Control" title="Admin" id={user.id} name={fullName} email={user.email}>
        <span className="font-mono text-xs text-ink-60 hidden md:inline">{activeEvent.name}</span>
      </AppHeader>
      <div className="flex-1 p-4 sm:p-6">
        <div className="max-w-5xl mx-auto">
          <AdminClient eventId={activeEvent.id} eventState={eventState} questions={questions || []} />
        </div>
      </div>
    </main>
  )
}
