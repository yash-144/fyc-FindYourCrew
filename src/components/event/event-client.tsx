'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { submitResponse } from '@/server/answer-actions'
import { useRealtime } from '@/hooks/use-realtime'
import { CrewmateIcon } from '@/components/ui/crewmate-icon'
import { PhaseFade } from '@/components/ui/phase-fade'
import { GameBeginTransition } from '@/components/event/game-begin-transition'
import { CREW_COLORS } from '@/lib/crew-color'

// Seconds of "3.. 2.. 1.." shown before a question's own answer timer starts
// counting down — purely a client-side beat, no server state needed for it.
const REVEAL_COUNTDOWN_SECONDS = 3

// Deliberately in normal document flow, never `fixed` — a floating corner
// HUD was overlapping the centered question content on narrower screens
// (this app is mobile-first, so "narrower" is the common case, not the
// edge case). Sitting inline above the phase content instead means it can
// never overlap anything, on any viewport, at the cost of a little vertical
// space that a slim strip barely notices.
function TaskHud({ total, current }: { total: number; current: number }) {
  if (total <= 0) return null
  return (
    <div className="task-hud flex items-center justify-center gap-3 mb-4 px-4 py-2.5 w-full max-w-md mx-auto">
      <div className="flex items-center gap-1.5 flex-1 justify-center">
        {Array.from({ length: total }, (_, i) => i + 1).map((n) => {
          const done = n < current
          const isCurrent = n === current
          return (
            <span
              key={n}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                isCurrent ? 'w-6 bg-red' : done ? 'w-2.5 bg-go' : 'w-2.5 bg-space-line'
              }`}
            />
          )
        })}
      </div>
      <span className="crew-label whitespace-nowrap">Task {current}/{total}</span>
    </div>
  )
}

export function EventClient({ eventId, participantId }: { eventId: string, participantId: string }) {
  const router = useRouter()
  const [eventState, setEventState] = useState<any>(null)
  const [questionData, setQuestionData] = useState<any>(null)
  const [selectedOption, setSelectedOption] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [totalQuestions, setTotalQuestions] = useState(0)
  const [currentPosition, setCurrentPosition] = useState<number | null>(null)
  const [matchResult, setMatchResult] = useState<{ matched: boolean } | null>(null)

  const { eventUpdate } = useRealtime(eventId)

  useEffect(() => {
    fetch(`/api/questions-meta?eventId=${eventId}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setTotalQuestions(d.total || 0))
      .catch(() => {})
  }, [eventId])

  // One fetch on mount for whatever's already in progress (first load, or a
  // reload/reconnect that missed broadcasts while away) — including the
  // active question itself, if one's already underway. Every subsequent
  // state change arrives pushed over the WebSocket instead — see the effect
  // below — so this deliberately does NOT depend on anything that would
  // re-run it per broadcast.
  useEffect(() => {
    let cancelled = false
    fetch(`/api/event-state?eventId=${eventId}`, { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        setEventState(data)
        if ((data.status === 'QUESTION_INTRO' || data.status === 'QUESTION_ACTIVE') && data.active_question_id) {
          return fetch(`/api/question?id=${data.active_question_id}`, { cache: 'no-store' })
            .then((r) => (r.ok ? r.json() : null))
            .then((q) => { if (!cancelled && q) { setQuestionData(q); setCurrentPosition(q.position) } })
        }
      })
      .catch((err) => console.error('Fetch state error', err))
    return () => { cancelled = true }
  }, [eventId])

  // The admin already has the new event_state (and, during a question
  // phase, the question itself) the moment their click succeeds, and pushes
  // both in the broadcast — so every connected participant can apply the
  // update directly instead of every one of them independently calling
  // /api/event-state and /api/question the instant they see the broadcast.
  useEffect(() => {
    if (!eventUpdate) return
    setEventState(eventUpdate.eventState)
    if (eventUpdate.questionData) {
      setQuestionData(eventUpdate.questionData)
      setCurrentPosition(eventUpdate.questionData.position)
    } else {
      setQuestionData(null)
      setSelectedOption(null)
    }
  }, [eventUpdate])

  // Ticks `now` while a question's timer is running — countdownLeft/timeLeft/
  // timesUp below are *derived* from it during render, not separately-managed
  // state. That matters: with them as their own state (the old design), the
  // render that flips eventState.status to QUESTION_ACTIVE landed with
  // countdownLeft still null (stale from before — the interval that would
  // set it hadn't ticked yet), so the full question+options UI flashed for a
  // frame before the 3-2-1 countdown took over. A regular useEffect can't
  // fix that — it runs after paint, so the stale frame is already on screen
  // by the time it fires. useLayoutEffect runs synchronously before the
  // browser paints, so refreshing `now` here catches the very first render
  // of this phase before anything is ever shown.
  useLayoutEffect(() => {
    if (eventState?.status !== 'QUESTION_ACTIVE' || !eventState.timer_started_at) return
    setNow(Date.now())
    const interval = setInterval(() => setNow(Date.now()), 200)
    return () => clearInterval(interval)
  }, [eventState?.status, eventState?.timer_started_at])

  let countdownLeft: number | null = null
  let timeLeft = 0
  let timesUp = false
  if (eventState?.status === 'QUESTION_ACTIVE' && eventState.timer_started_at && eventState.timer_duration_seconds) {
    const started = new Date(eventState.timer_started_at).getTime()
    const elapsed = (now - started) / 1000
    if (elapsed < REVEAL_COUNTDOWN_SECONDS) {
      countdownLeft = Math.ceil(REVEAL_COUNTDOWN_SECONDS - elapsed)
    } else {
      const remain = Math.max(0, eventState.timer_duration_seconds - (elapsed - REVEAL_COUNTDOWN_SECONDS))
      timeLeft = Math.floor(remain)
      timesUp = remain <= 0
    }
  }

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

  // Plays once — the moment this participant's resolved status is first
  // PRE_GAME, whether that's from arriving fresh off the lobby redirect or
  // a reload that landed mid-PRE_GAME. Never replays on a later broadcast
  // that happens to still report PRE_GAME.
  const playedBeginIntroRef = useRef(false)
  const [playBeginIntro, setPlayBeginIntro] = useState(false)
  useEffect(() => {
    if (eventState?.status === 'PRE_GAME' && !playedBeginIntroRef.current) {
      playedBeginIntroRef.current = true
      setPlayBeginIntro(true)
    }
  }, [eventState?.status])

  const phaseKey = `${eventState?.status ?? 'loading'}-${eventState?.active_question_id ?? ''}-${timesUp}-${matchResult?.matched ?? ''}`
  const showHud = totalQuestions > 0 && currentPosition !== null &&
    ['QUESTION_INTRO', 'QUESTION_ACTIVE', 'QUESTION_LOCKED'].includes(eventState?.status)

  return (
    <>
      <GameBeginTransition active={playBeginIntro} />
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
    // Blank rather than a "Syncing..." label — the page's own dark space-bg
    // is already showing, and the brief gap before the mount fetch resolves
    // (most visibly right after the lobby -> event navigation, just before
    // PRE_GAME's blackout takes over) shouldn't flash text at all.
    return null
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
          {/* key={countdownLeft} replays the pop only when the number actually
              changes (the interval driving it ticks every 200ms, far more often
              than the displayed value does) — that's what makes 3 -> 2 -> 1 read
              as a smooth beat instead of an abrupt swap. */}
          <div key={countdownLeft} className="countdown-pop font-display font-black text-8xl text-red tabular-nums">
            {countdownLeft}
          </div>
        </div>
      )
    }

    if (timesUp) {
      // Nothing for the participant to do here either way, but "waiting for
      // the admin to lock responses" describes internal plumbing they have
      // no way to act on. Telling them their own status instead — did their
      // answer register or not — is the version of this that's actually
      // useful to read.
      return (
        <div className="text-center space-y-2">
          <div className="font-display font-black text-5xl text-red">TIME&rsquo;S UP</div>
          <p className="crew-label">
            {selectedOption ? "You're locked in — next task coming up." : "You'll join the next task."}
          </p>
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
        {/* Fixed size regardless of how long this particular question's text
            or option list is — a question box that grows/shrinks per question
            makes the layout jump around between tasks. Each region scrolls
            internally instead of resizing the box for an unusually long
            question or an unusually long option list. */}
        <div className="panel-dark p-6 flex flex-col gap-4 h-[60vh] min-h-[360px] max-h-[520px]">
          <div className="relative shrink-0 max-h-[42%]">
            <p className="font-display font-semibold text-xl leading-snug text-starlight overflow-y-auto max-h-full pb-2">
              {questionData.body}
            </p>
            {/* Scroll affordance — an unusually long question is capped and
                scrolls rather than growing the box, but a hard clip with no
                visual cue reads as broken/truncated rather than scrollable. */}
            <div className="pointer-events-none absolute bottom-0 inset-x-0 h-5 bg-gradient-to-t from-space-panel to-transparent" />
          </div>
          <div className="space-y-3 overflow-y-auto flex-1 min-h-0">
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
    // Brief and usually skipped past quickly (the admin locks and advances
    // in one motion) — distinct copy from the TIME'S UP beat right before
    // it so back-to-back it doesn't read as the same message twice.
    return (
      <div className="text-center space-y-3">
        <div className="crew-label-red">Answers locked in</div>
        <div className="flex justify-center gap-2">
          {[0, 1, 2].map((i) => (
            <span key={i} className="w-2 h-2 rounded-full bg-red matching-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
          ))}
        </div>
      </div>
    )
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
      return <div className="crew-label">One sec — finding your crew...</div>
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

  // Shouldn't normally be reachable — every real status is handled above —
  // but stays human rather than exposing internal state-machine language if
  // an unrecognized status ever lands here.
  return <div className="text-starlight-dim font-medium">Hang tight — the next part is on its way.</div>
}
