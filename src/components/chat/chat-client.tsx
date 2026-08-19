'use client'

import { useState } from 'react'
import { Send, Sparkles, Flag, Check } from 'lucide-react'
import { useRealtime } from '@/hooks/use-realtime'
import { submitChatMessage, reportMessage, type ReportReason } from '@/server/chat-actions'
import { containsBlockedWord } from '@/lib/blocklist'
import { Avatar } from '@/components/ui/avatar'

interface CrewMember {
  name: string
  colorId: string
}

const REPORT_REASONS: ReportReason[] = ['Inappropriate language', 'Harassment', 'Spam', 'Other']

export function ChatClient({
  eventId,
  groupId,
  participantId,
  initialMessages = [],
  groupName,
  icebreakerPrompt,
  members = {},
  selfName = 'You',
  selfId,
}: {
  eventId: string
  groupId: string
  participantId: string
  initialMessages?: any[]
  groupName?: string
  icebreakerPrompt?: string | null
  members?: Record<string, CrewMember>
  selfName?: string
  selfId?: string
}) {
  const [inputText, setInputText] = useState('')
  const [sendError, setSendError] = useState<string | null>(null)
  const [reportingId, setReportingId] = useState<string | null>(null)
  const [reportedIds, setReportedIds] = useState<Set<string>>(new Set())
  const { connected, messages: realtimeMessages, broadcastChat } = useRealtime(eventId, groupId)

  // Combine initial persisted messages with real-time ones
  const allMessages = [...initialMessages, ...realtimeMessages].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

  // Deduplicate by ID
  const uniqueMessages = Array.from(new Map(allMessages.map(item => [item.id, item])).values())

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault()
    const textToSend = inputText.trim()
    if (!textToSend) return

    // Client-side check first — instant feedback, no round-trip. The real
    // enforcement is the identical server-side check in submitChatMessage;
    // this alone is trivially bypassable and isn't trusted on its own.
    if (containsBlockedWord(textToSend)) {
      setSendError('Message blocked: please keep it respectful.')
      return
    }

    setInputText('')
    setSendError(null)

    try {
      const persisted = await submitChatMessage(eventId, groupId, textToSend)
      broadcastChat(persisted)
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Failed to send message')
    }
  }

  const identityFor = (senderId: string): CrewMember =>
    senderId === participantId
      ? { name: selfName, colorId: selfId ?? senderId }
      : (members[senderId] ?? { name: 'Crew Member', colorId: senderId })

  const handleReport = async (messageId: string, senderId: string, text: string, reason: ReportReason) => {
    setReportingId(null)
    try {
      await reportMessage({ eventId, groupId, messageId, reportedParticipantId: senderId, reason, messageText: text })
      setReportedIds(prev => new Set(prev).add(messageId))
    } catch (err) {
      console.error('Failed to report message', err)
    }
  }

  return (
    <div className="flex flex-col h-full max-h-[calc(100vh-6rem)] w-full max-w-lg panel-dark overflow-hidden">
      <div className="p-4 border-b-2 border-space-line flex justify-between items-center gap-3">
        <div className="min-w-0">
          <h3 className="font-display font-bold text-starlight truncate">{groupName || 'Crew Chat'}</h3>
          <div className="font-mono text-[0.65rem] text-starlight-dim">{Object.keys(members).length || '—'} on frequency</div>
        </div>
        <span className={`chip ${connected ? 'chip-red' : ''}`}>
          <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${connected ? 'bg-red' : 'bg-starlight-dim'}`} />
          {connected ? 'Live' : 'Offline'}
        </span>
      </div>

      {icebreakerPrompt && (
        <div className="px-4 py-2.5 border-b-2 border-space-line bg-mustard-tint flex items-start gap-2">
          <Sparkles className="w-3.5 h-3.5 text-mustard shrink-0 mt-0.5" />
          <p className="font-mono text-xs text-starlight-dim leading-relaxed">{icebreakerPrompt}</p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {uniqueMessages.length === 0 && (
          <div className="h-full flex items-center justify-center">
            <p className="crew-label text-center">Frequency is open. Say hi.</p>
          </div>
        )}
        {uniqueMessages.map(m => {
          const isMe = m.sender_participant_id === participantId
          const identity = identityFor(m.sender_participant_id)
          const isReporting = reportingId === m.id
          const isReported = reportedIds.has(m.id)
          return (
            <div key={m.id} className={`flex items-end gap-2 group ${isMe ? 'justify-end' : 'justify-start'}`}>
              {!isMe && <Avatar id={identity.colorId} name={identity.name} size="sm" variant="dark" />}
              <div className={`flex flex-col gap-1 max-w-[75%] relative ${isMe ? 'items-end' : 'items-start'}`}>
                {!isMe && <span className="crew-label-red px-1">{identity.name}</span>}
                <div className="flex items-center gap-1.5">
                  <div
                    className={`px-3.5 py-2.5 text-sm leading-relaxed rounded-2xl ${
                      isMe
                        ? 'bg-red text-starlight rounded-br-sm'
                        : 'bg-space-panel-raised border-2 border-space-line text-starlight rounded-bl-sm'
                    }`}
                  >
                    {m.censored_text}
                  </div>
                  {!isMe && (
                    isReported ? (
                      <Check className="w-3.5 h-3.5 text-go shrink-0" />
                    ) : (
                      <button
                        onClick={() => setReportingId(isReporting ? null : m.id)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-starlight-dim hover:text-red shrink-0"
                        title="Report this message"
                      >
                        <Flag className="w-3.5 h-3.5" />
                      </button>
                    )
                  )}
                </div>
                {isReporting && (
                  <div className="panel-dark-raised p-2 flex flex-col gap-1 z-10">
                    {REPORT_REASONS.map(reason => (
                      <button
                        key={reason}
                        onClick={() => handleReport(m.id, m.sender_participant_id, m.censored_text, reason)}
                        className="font-mono text-[0.65rem] text-left px-2 py-1 rounded text-starlight-dim hover:text-red hover:bg-red-tint transition-colors"
                      >
                        {reason}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {isMe && <Avatar id={identity.colorId} name={identity.name} size="sm" variant="dark" />}
            </div>
          )
        })}
      </div>

      {sendError && (
        <div className="mx-4 mb-2 font-mono text-xs text-red border-2 border-red bg-red-tint px-3 py-2 rounded-lg">
          {sendError}
        </div>
      )}

      <div className="p-3 border-t-2 border-space-line">
        <form onSubmit={handleSend} className="flex gap-2">
          <input
            type="text"
            value={inputText}
            onChange={e => { setInputText(e.target.value); if (sendError) setSendError(null) }}
            className="input-among flex-1 rounded-full text-sm"
            placeholder="Type a message..."
          />
          <button
            type="submit"
            disabled={!inputText.trim()}
            className="btn-among rounded-full !px-4 aspect-square"
            aria-label="Send"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  )
}
