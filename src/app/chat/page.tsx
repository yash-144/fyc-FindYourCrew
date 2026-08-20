import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ChatClient } from '@/components/chat/chat-client'
import { CrewHeader } from '@/components/ui/crew-header'
import { getViewerProfile } from '@/lib/get-viewer-profile'

export default async function ChatPage() {
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

  if (eventStatus !== 'GROUP_CHAT_OPEN') {
    redirect('/event')
  }

  // Get user's group
  const { data: groupMember } = await supabase
    .from('group_members')
    .select('group_id, groups(name, code, icebreaker_prompt)')
    .eq('participant_id', participant.id)
    .single()

  if (!groupMember) {
    return (
      <main className="space-bg flex min-h-dvh flex-col">
        <CrewHeader eyebrow="Crew Chat" title="Find Your Crew" id={user.id} name={fullName} email={user.email} />
        <div className="flex-1 flex items-center justify-center p-6 text-center">
          <div className="panel-dark p-6">
            <p className="text-starlight-dim">You are not in a group.</p>
          </div>
        </div>
      </main>
    )
  }

  // Resolve every crew member's display name for the thread.
  const { data: crew } = await supabase
    .from('group_members')
    .select('participant_id, event_participants(profile_id, profiles(full_name))')
    .eq('group_id', groupMember.group_id)

  const members: Record<string, { name: string; colorId: string }> = {}
  for (const row of crew ?? []) {
    const ep = row.event_participants as any
    const profile = ep?.profiles
    members[row.participant_id as string] = {
      name: profile?.full_name ?? 'Crew Member',
      colorId: ep?.profile_id ?? (row.participant_id as string),
    }
  }

  const group = groupMember.groups as any

  // Message history — without this, ChatClient only ever shows messages that
  // arrive over the live socket after the page loads, so a refresh (or
  // anyone joining the thread partway through) would silently lose everything
  // sent before that point.
  const { data: history } = await supabase
    .from('chat_messages')
    .select('id, censored_text, created_at, sender_participant_id')
    .eq('group_id', groupMember.group_id)
    .order('created_at', { ascending: true })

  return (
    <main className="space-bg relative flex h-screen flex-col">
      <CrewHeader
        eyebrow="Frequency Open"
        title={group?.name ? `Crew: ${group.name}` : 'Crew Chat'}
        id={user.id}
        name={fullName}
        email={user.email}
      />
      <div className="flex-1 flex flex-col items-center justify-center p-4 sm:p-6 overflow-hidden">
        <ChatClient
          eventId={participant.event_id}
          participantId={participant.id}
          groupId={groupMember.group_id}
          groupName={group?.name}
          icebreakerPrompt={group?.icebreaker_prompt}
          members={members}
          selfName={fullName ?? 'You'}
          selfId={user.id}
          initialMessages={history ?? []}
        />
      </div>
    </main>
  )
}
