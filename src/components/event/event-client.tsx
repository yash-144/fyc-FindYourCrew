'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check } from 'lucide-react'
import { submitResponse } from '@/server/answer-actions'
import { useRealtime } from '@/hooks/use-realtime'
import { CrewmateIcon } from '@/components/ui/crewmate-icon'
import { PhaseFade } from '@/components/ui/phase-fade'
import { CREW_COLORS } from '@/lib/crew-color'

// Seconds of "3.. 2.. 1.." shown before a question's own answer timer starts
// counting down — purely a client-side beat, no server state needed for it.
const REVEAL_COUNTDOWN_SECONDS = 3

function TaskHud({ total, current }: { total: number; current: number }) {
  if (total <= 0) return null
  return (
    <div className="task-hud fixed top-20 left-4 sm:left-6 z-20 w-40">
      <div className="crew-label mb-2">Tasks</div>
      <div className="space-y-1.5">
        {Array.from({ length: total }, (_, i) => i + 1).map((n) => {
          const done = n < current
          const isCurrent = n === current
          return (
            <div key={n} className={`task-item ${isCurrent ? 'is-current' : ''}`}>
              <span className={`task-check ${done ? 'is-done' : ''} ${isCurrent ? 'is-current' : ''}`}>
                {done && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
              </span>
              Task {n.toString().padStart(2, '0')}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function EventClient({ eventId, participantId }: { eventId: string, participantId: string }) {
  const router = useRouter()
  const [eventState, setEventState] = useState<any>(null)
  const [questionData, setQuestionData] = useState<any>(null)
  const [selectedOption, setSelectedOption] = useState<string | null>(null)
  const [timeLeft, setTimeLeft] = useState<number>(0)
  const [countdownLeft, setCountdownLeft] = useState<number | null>(null)
  const [timesUp, setTimesUp] = useState(false)
  const [totalQuestions, setTotalQuestions] = useState(0)
  const [currentPosition, setCurrentPosition] = useState<number | null>(null)
  const [matchResult, setMatchResult] = useState<{ matched: boolean } | null>(null)

  const { refreshTrigger } = useRealtime(eventId)

  useEffect(() => {
    fetch(`/api/questions-meta?eventId=${eventId}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setTotalQuestions(d.total || 0))
      .catch(() => {})
  }, [eventId])

  useEffect(() => {
    const fetchState = async () => {
      try {
        const res = await fetch(`/api/event-state?eventId=${eventId}`, { cache: 'no-store' })
        if (res.ok) {
          const data = await res.json()
          setEventState(data)
        }
      } catch (err) {
        console.error("Fetch state error", err)
      }
    }

    fetchState()
  }, [eventId, refreshTrigger])

  useEffect(() => {
    if ((eventState?.status === 'QUESTION_INTRO' || eventState?.status === 'QUESTION_ACTIVE') && eventState.active_question_id) {
       fetch(`/api/question?id=${eventState.active_question_id}`, { cache: 'no-store' })
         .then(r => r.json())
         .then((q) => { setQuestionData(q); setCurrentPosition(q.position) })
    } else {
       setQuestionData(null)
       setSelectedOption(null)
    }
  }, [eventState?.status, eventState?.active_question_id])

  // The reveal countdown, the answer timer, and the auto "time's up" beat are
  // all derived from the one server timestamp — nothing here is server
  // state, so it survives refreshes/reconnects without drifting.
  useEffect(() => {
    setTimesUp(false)
    if (eventState?.status === 'QUESTION_ACTIVE' && eventState.timer_started_at && eventState.timer_duration_seconds) {
      const interval = setInterval(() => {
         const started = new Date(eventState.timer_started_at).getTime()
         const elapsed = (Date.now() - started) / 1000

         if (elapsed < REVEAL_COUNTDOWN_SECONDS) {
           setCountdownLeft(Math.ceil(REVEAL_COUNTDOWN_SECONDS - elapsed))
           return
         }
         setCountdownLeft(null)

         const remain = Math.max(0, eventState.timer_duration_seconds - (elapsed - REVEAL_COUNTDOWN_SECONDS))
         setTimeLeft(Math.floor(remain))
         if (remain <= 0) setTimesUp(true)
      }, 200)
      return () => clearInterval(interval)
    } else {
      setCountdownLeft(null)
    }
  }, [eventState?.status, eventState?.timer_started_at, eventState?.timer_duration_seconds])

  // GROUP_CHAT_OPEN: find out whether this participant actually landed in a
  // group before doing anything — an ejected participant should see that,
  // not get bounced into a chat page with nothing in it.
  useEffect(() => {
    if (eventState?.status !== 'GROUP_CHAT_OPEN') {
      setMatchResult(null)
      return
    }
    let cancelled = false
    fetch(`/api/match-result?participantId=${participantId}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setMatchResult({ matched: !!d.matched }) })
      .catch(() => { if (!cancelled) setMatchResult({ matched: false }) })
    return () => { cancelled = true }
  }, [eventState?.status, participantId])

  const handleSelect = async (optionId: string) => {
    if (eventState?.status !== 'QUESTION_ACTIVE' || countdownLeft !== null || timesUp) return
    setSelectedOption(optionId)
    await submitResponse(eventId, eventState.active_question_id, optionId).catch(console.error)
  }

  const phaseKey = `${eventState?.status ?? 'loading'}-${eventState?.active_question_id ?? ''}-${timesUp}-${matchResult?.matched ?? ''}`
  const showHud = totalQuestions > 0 && currentPosition !== null &&
    ['QUESTION_INTRO', 'QUESTION_ACTIVE', 'QUESTION_LOCKED'].includes(eventState?.status)

  return (
    <>
      {showHud && <TaskHud total={totalQuestions} current={currentPosition!} />}
      <PhaseFade phaseKey={phaseKey}>
        <EventPhase
          eventState={eventState}
          questionData={questionData}
          selectedOption={selectedOption}
          timeLeft={timeLeft}
          countdownLeft={countdownLeft}
          timesUp={timesUp}
          matchResult={matchResult}
          onSelect={handleSelect}
          onEnterChat={() => router.push('/chat')}
        />
      </PhaseFade>
    </>
  )
}

function EventPhase({
  eventState,
  questionData,
  selectedOption,
  timeLeft,
  countdownLeft,
  timesUp,
  matchResult,
  onSelect,
  onEnterChat,
}: {
  eventState: any
  questionData: any
  selectedOption: string | null
  timeLeft: number
  countdownLeft: number | null
  timesUp: boolean
  matchResult: { matched: boolean } | null
  onSelect: (optionId: string) => void
  onEnterChat: () => void
}) {
  if (!eventState) {
    return <div className="crew-label">Syncing...</div>
  }

  if (eventState.status === 'PRE_GAME') {
    return (
      <div className="text-center space-y-4 max-w-sm">
        <div className="crew-label-red">Attention Crew</div>
        <div className="font-display font-bold text-4xl text-starlight">
          THE GAME IS<br />ABOUT TO BEGIN.
        </div>
        <p className="text-starlight-dim">Get comfortable — the first task is coming up.</p>
      </div>
    )
  }

  if (eventState.status === 'QUESTION_INTRO') {
    return (
      <div className="text-center space-y-5 max-w-sm">
        <div className="crew-label-red">Task {String(questionData?.position ?? '').padStart(2, '0')}</div>
        <div className="font-display font-bold text-2xl text-starlight leading-snug">
          {questionData?.title || 'Get ready.'}
        </div>
        <p className="text-starlight-dim">The timer starts next — get ready to answer.</p>
        <div className="flex justify-center gap-2 pt-2">
          {[0, 1, 2].map((i) => (
            <span key={i} className="w-2 h-2 rounded-full bg-red matching-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
          ))}
        </div>
      </div>
    )
  }

  if (eventState.status === 'QUESTION_ACTIVE' && questionData) {
    if (countdownLeft !== null) {
      return (
        <div className="text-center space-y-2">
          <div className="crew-label">Task {String(questionData.position).padStart(2, '0')} starts in</div>
          <div className="font-display font-black text-8xl text-red tabular-nums">{countdownLeft}</div>
        </div>
      )
    }

    if (timesUp) {
      return (
        <div className="text-center space-y-2">
          <div className="font-display font-black text-5xl text-red">TIME&rsquo;S UP</div>
          <p className="crew-label">Waiting for the admin to lock responses...</p>
        </div>
      )
    }

    const letters = ['A', 'B', 'C', 'D', 'E', 'F']
    return (
      <div className="w-full max-w-md space-y-4">
        <div className="flex justify-between items-center px-1">
          <h2 className="crew-label-red">Task {String(questionData.position).padStart(2, '0')}</h2>
          <div className={`font-mono text-lg font-bold tabular-nums ${timeLeft < 10 ? 'text-red' : 'text-starlight-dim'}`}>
            00:{timeLeft.toString().padStart(2, '0')}
          </div>
        </div>
        <div className="panel-dark p-6 space-y-6">
          <p className="font-display font-semibold text-xl leading-snug text-starlight">{questionData.body}</p>
          <div className="space-y-3">
            {questionData.options.map((opt: any, i: number) => (
              <button
                key={opt.id}
                className={`option-among w-full flex items-center gap-3 ${selectedOption === opt.id ? 'is-selected' : ''}`}
                onClick={() => onSelect(opt.id)}
              >
                <span className="font-mono text-xs font-bold text-starlight-dim shrink-0">{letters[i]}</span>
                <span className="font-medium text-starlight">{opt.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (eventState.status === 'QUESTION_LOCKED') {
    return <div className="crew-label-red">Locking responses...</div>
  }

  if (eventState.status === 'MATCHING') {
     const bounceColors = CREW_COLORS.slice(0, 5)
     return (
       <div className="flex flex-col items-center gap-8 text-center">
         <div className="flex items-end gap-3 h-16">
           {bounceColors.map((c, i) => (
             <div key={c} className="matching-bounce" style={{ animationDelay: `${i * 0.12}s` }}>
               <CrewmateIcon color={c} size={40} />
             </div>
           ))}
         </div>
         <div className="font-display font-bold text-3xl sm:text-4xl text-starlight">
           MAPPING<br /><span className="text-red">YOUR CREW...</span>
         </div>
       </div>
     )
  }

  if (eventState.status === 'GROUP_CHAT_OPEN') {
    if (!matchResult) {
      return <div className="crew-label">Checking your crew...</div>
    }

    if (!matchResult.matched) {
      return (
        <div className="text-center space-y-4 max-w-sm">
          <div className="opacity-40 grayscale">
            <CrewmateIcon color="red" size={90} className="mx-auto" />
          </div>
          <div className="font-display font-black text-4xl text-red">EJECTED</div>
          <p className="text-starlight-dim">
            You didn&rsquo;t answer enough tasks to be matched with a crew this round.
            Find an event coordinator — they can help sort it out.
          </p>
        </div>
      )
    }

    return (
      <div className="text-center space-y-6 max-w-sm">
        <div className="flex justify-center gap-2">
          {CREW_COLORS.slice(0, 4).map((c, i) => (
            <div key={c} className="matching-bounce" style={{ animationDelay: `${i * 0.1}s` }}>
              <CrewmateIcon color={c} size={44} />
            </div>
          ))}
        </div>
        <div className="font-display font-black text-4xl text-starlight">CREW FOUND!</div>
        <p className="text-starlight-dim">Your crew is assembled and waiting.</p>
        <button onClick={onEnterChat} className="btn-among px-8 py-3.5">
          ENTER CREW CHAT
        </button>
      </div>
    )
  }

  return <div className="text-starlight-dim font-medium">Waiting for the event to progress...</div>
}
