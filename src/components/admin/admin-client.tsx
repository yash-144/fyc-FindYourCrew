'use client'

import { useState } from 'react'
import { updateEventStatus, updateQuestionStatus, createQuestion, updateQuestion, deleteQuestion, reorderQuestions } from '@/server/event-actions'
import { Plus, Trash2, Edit2, Play, CheckCircle, Save, X, ChevronUp, ChevronDown, Circle } from 'lucide-react'
import { useRealtime } from '@/hooks/use-realtime'

type Tab = 'controls' | 'questions'

const TABS: { id: Tab; label: string }[] = [
  { id: 'controls', label: 'Event Controls' },
  { id: 'questions', label: 'Question CMS' },
]

const PHASES = [
  { id: 'SETUP', label: 'Setup', match: ['SETUP'] },
  { id: 'LOBBY', label: 'Lobby', match: ['LOBBY', 'PRE_GAME'] },
  { id: 'QUESTIONS', label: 'Questions', match: ['QUESTION_INTRO', 'QUESTION_ACTIVE', 'QUESTION_LOCKED'] },
  { id: 'MATCHING', label: 'Matching', match: ['MATCHING'] },
  { id: 'GROUP_CHAT_OPEN', label: 'Group Chat', match: ['GROUP_CHAT_OPEN'] },
] as const

const QUESTION_STATUSES = ['QUESTION_INTRO', 'QUESTION_ACTIVE', 'QUESTION_LOCKED']

export function AdminClient({ eventId, eventState, questions }: { eventId: string, eventState: any, questions: any[] }) {
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('controls')
  const [adminError, setAdminError] = useState<string | null>(null)
  const { broadcastEvent } = useRealtime(eventId)

  // Question CRUD State
  const [editingQuestion, setEditingQuestion] = useState<any | null>(null)

  // Every mutating action shares the same shape: show loading, clear any
  // previous error, run the mutation, tell other clients to refetch, and
  // surface whatever went wrong instead of failing silently. Previously
  // handleStateChange/handleAdvanceEvent duplicated this by hand and the
  // question CRUD handlers skipped error handling entirely.
  const runAction = async (fn: () => Promise<void>) => {
    setLoading(true)
    setAdminError(null)
    try {
      await fn()
      broadcastEvent({ type: 'event_state_update' })
    } catch (err) {
      setAdminError(err instanceof Error ? err.message : 'An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  const applyStatus = (status: string, extra?: { questionId?: string; durationSeconds?: number }) =>
    status.startsWith('QUESTION')
      ? updateQuestionStatus(eventId, extra?.questionId || eventState?.active_question_id || null, status, extra?.durationSeconds)
      : updateEventStatus(eventId, status)

  const handleStateChange = (status: string, extra?: any) =>
    runAction(() => applyStatus(status, extra))

  const handleAdvanceEvent = () =>
    runAction(async () => {
      const currentStatus = eventState?.status || 'SETUP'
      const currentQId = eventState?.active_question_id

      let nextStatus = ''
      let extraArgs: { questionId?: string; durationSeconds?: number } = {}

      if (currentStatus === 'SETUP') {
        nextStatus = 'LOBBY'
      } else if (currentStatus === 'LOBBY') {
        // A beat in the lobby announcing the game is starting, before the
        // first task intro — gives the room a moment to settle.
        nextStatus = 'PRE_GAME'
      } else if (currentStatus === 'PRE_GAME') {
        if (questions.length > 0) {
          // Intro only — no timer yet. The auditorium video plays during
          // this phase; the answer timer starts on the next advance.
          nextStatus = 'QUESTION_INTRO'
          extraArgs = { questionId: questions[0].id }
        } else {
          nextStatus = 'MATCHING'
        }
      } else if (currentStatus === 'QUESTION_INTRO') {
        const q = questions.find(x => x.id === currentQId) || questions[0]
        nextStatus = 'QUESTION_ACTIVE'
        extraArgs = { questionId: q?.id, durationSeconds: q?.timer_seconds }
      } else if (currentStatus === 'QUESTION_ACTIVE') {
        nextStatus = 'QUESTION_LOCKED'
        extraArgs = { questionId: currentQId }
      } else if (currentStatus === 'QUESTION_LOCKED') {
        // Find next question — no metrics reveal in between anymore.
        const currentIndex = questions.findIndex(q => q.id === currentQId)
        if (currentIndex !== -1 && currentIndex + 1 < questions.length) {
          const nextQ = questions[currentIndex + 1]
          nextStatus = 'QUESTION_INTRO'
          extraArgs = { questionId: nextQ.id }
        } else {
          nextStatus = 'MATCHING'
        }
      } else if (currentStatus === 'MATCHING') {
        nextStatus = 'GROUP_CHAT_OPEN'
      }

      if (nextStatus) {
        await applyStatus(nextStatus, extraArgs)
      }
    })

  const getNextStateLabel = () => {
    const currentStatus = eventState?.status || 'SETUP'
    const currentQId = eventState?.active_question_id

    if (currentStatus === 'SETUP') return 'Open Lobby'
    if (currentStatus === 'LOBBY') return 'Begin Game'
    if (currentStatus === 'PRE_GAME') {
      return questions.length > 0 ? `Show Task 1 Intro: ${questions[0].title}` : 'Start Matching'
    }
    if (currentStatus === 'QUESTION_INTRO') return 'Reveal Task — Start Timer'
    if (currentStatus === 'QUESTION_ACTIVE') return 'Lock Current Question'
    if (currentStatus === 'QUESTION_LOCKED') {
      const currentIndex = questions.findIndex(q => q.id === currentQId)
      if (currentIndex !== -1 && currentIndex + 1 < questions.length) {
        return `Show Task ${currentIndex + 2} Intro: ${questions[currentIndex + 1].title}`
      }
      return 'Start Matching'
    }
    if (currentStatus === 'MATCHING') return 'Open Group Chat'
    return 'Event Complete'
  }

  const handleSaveQuestion = (e: React.FormEvent) => {
    e.preventDefault()
    runAction(async () => {
      if (editingQuestion.id === 'new') {
        await createQuestion(eventId, {
          title: editingQuestion.title,
          body: editingQuestion.body,
          timer_seconds: editingQuestion.timer_seconds
        }, editingQuestion.options)
      } else {
        await updateQuestion(editingQuestion.id, {
          title: editingQuestion.title,
          body: editingQuestion.body,
          timer_seconds: editingQuestion.timer_seconds
        }, editingQuestion.options)
      }
      setEditingQuestion(null)
    })
  }

  const handleDeleteQuestion = (qId: string) => {
    if (!confirm('Are you sure you want to delete this question?')) return
    runAction(() => deleteQuestion(qId))
  }

  const handleMoveQuestion = (index: number, direction: 'up' | 'down') => {
    if ((direction === 'up' && index === 0) || (direction === 'down' && index === questions.length - 1)) return
    const newOrder = [...questions]
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    const temp = newOrder[index]
    newOrder[index] = newOrder[targetIndex]
    newOrder[targetIndex] = temp
    runAction(() => reorderQuestions(eventId, newOrder.map(q => q.id)))
  }

  const startEditQuestion = (q: any) => {
    const sortedOptions = [...(q.options || [])].sort((a, b) => a.option_key.localeCompare(b.option_key))
    // Pad with empty options if fewer than 4
    while (sortedOptions.length < 4) {
      const nextKey = String.fromCharCode(65 + sortedOptions.length) // 'A', 'B', etc.
      sortedOptions.push({ option_key: nextKey, label: '' })
    }
    setEditingQuestion({ ...q, options: sortedOptions })
  }

  const defaultNewQuestion = {
    id: 'new', title: '', body: '', timer_seconds: 45,
    options: [
      { option_key: 'A', label: '' },
      { option_key: 'B', label: '' },
      { option_key: 'C', label: '' },
      { option_key: 'D', label: '' }
    ]
  }

  return (
    <div className="space-y-6">

      {/* Tabs */}
      <div className="flex gap-1 border-[1.5px] border-line bg-card p-1 rounded-xl">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 py-2.5 font-mono text-xs uppercase tracking-widest transition-all rounded-lg ${
              activeTab === tab.id
                ? 'bg-red-tint text-red border-[1.5px] border-red'
                : 'text-ink-60 hover:text-ink border-[1.5px] border-transparent'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {adminError && (
        <div className="px-4 py-3 font-mono text-xs border-[1.5px] border-red bg-red-tint text-red rounded-lg break-words">
          {adminError}
        </div>
      )}

      {activeTab === 'controls' && (
        <div className="field-card p-5 sm:p-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
            <div className="min-w-0">
              <h2 className="font-display font-bold text-2xl tracking-tight text-ink">Mission Control</h2>
              <p className="text-ink-60 mt-1">
                Current State: <span className="font-mono text-red">{eventState?.status || 'None'}</span>
              </p>
              {QUESTION_STATUSES.includes(eventState?.status) && (
                <p className="font-mono text-xs text-mustard mt-1">
                  Question: {questions.find(q => q.id === eventState?.active_question_id)?.title || 'Unknown'}
                </p>
              )}
              {eventState?.status === 'QUESTION_INTRO' && (
                <p className="font-mono text-xs text-red mt-1">
                  ▶ Play the auditorium video now — advance to reveal the question &amp; start the timer.
                </p>
              )}
            </div>
            <button
              disabled={loading || eventState?.status === 'GROUP_CHAT_OPEN'}
              onClick={handleAdvanceEvent}
              className="btn-primary w-full sm:w-auto px-6 py-3 text-left sm:text-center leading-snug"
            >
              <Play className="w-4 h-4 shrink-0" />
              <span>{getNextStateLabel()}</span>
            </button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {PHASES.map(phase => {
              const isActive = (phase.match as readonly string[]).includes(eventState?.status)
              return (
                <button
                  key={phase.id}
                  disabled={loading}
                  onClick={() => handleStateChange(phase.match[0])}
                  className={`relative px-3 py-5 border-[1.5px] rounded-xl transition-all ${
                    isActive
                      ? 'border-red bg-red-tint text-red'
                      : 'border-line text-ink-35 hover:border-ink-60 hover:text-ink-60'
                  }`}
                >
                  <div className="flex flex-col items-center gap-2">
                    {isActive ? (
                      <CheckCircle className="w-6 h-6" />
                    ) : (
                      <Circle className="w-6 h-6 opacity-40" />
                    )}
                    <span className="font-mono text-[0.7rem] uppercase tracking-wider">
                      {phase.label}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {activeTab === 'questions' && (
        !editingQuestion ? (
          <div className="field-card overflow-hidden">
            <div className="p-5 sm:p-6 border-b-[1.5px] border-line flex justify-between items-center gap-3">
              <h2 className="font-display font-bold text-lg text-ink">Event Questions</h2>
              <button
                onClick={() => setEditingQuestion(defaultNewQuestion)}
                className="btn-secondary px-4 py-2 shrink-0"
              >
                <Plus className="w-4 h-4" />
                Add
              </button>
            </div>

            <div className="divide-y divide-line">
              {questions.length === 0 ? (
                <div className="p-12 text-center text-ink-60">
                  No questions created yet. Click &ldquo;Add&rdquo; to start.
                </div>
              ) : questions.map((q, i) => (
                <div key={q.id} className="p-4 hover:bg-paper transition-colors flex flex-wrap items-center gap-x-4 gap-y-3">
                  <div className="flex sm:flex-col gap-1">
                    <button disabled={loading || i === 0} onClick={() => handleMoveQuestion(i, 'up')} className="p-1 text-ink-35 hover:text-red disabled:opacity-30">
                      <ChevronUp className="w-4 h-4" />
                    </button>
                    <button disabled={loading || i === questions.length - 1} onClick={() => handleMoveQuestion(i, 'down')} className="p-1 text-ink-35 hover:text-red disabled:opacity-30">
                      <ChevronDown className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="flex-1 min-w-[65%] sm:min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <span className="flex items-center justify-center w-6 h-6 border-[1.5px] border-red rounded-full font-mono text-xs font-bold text-red shrink-0">
                        {q.position}
                      </span>
                      <h3 className="font-semibold text-lg text-ink truncate">{q.title || 'Untitled'}</h3>
                    </div>
                    <p className="text-ink-60 text-sm truncate pl-9">{q.body}</p>
                  </div>

                  <div className="flex items-center gap-3 ml-auto">
                    <span className="chip whitespace-nowrap">
                      {q.timer_seconds}s
                    </span>
                    <button
                      onClick={() => startEditQuestion(q)}
                      className="p-2 text-ink-35 hover:text-red transition-colors"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      disabled={loading}
                      onClick={() => handleDeleteQuestion(q.id)}
                      className="p-2 text-ink-35 hover:text-red transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="field-card overflow-hidden">
            <div className="p-5 sm:p-6 border-b-[1.5px] border-line flex justify-between items-center">
              <h2 className="font-display font-bold text-lg text-ink">{editingQuestion.id === 'new' ? 'Create New Question' : 'Edit Question'}</h2>
              <button onClick={() => setEditingQuestion(null)} className="p-2 text-ink-35 hover:text-red transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSaveQuestion} className="p-5 sm:p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="md:col-span-3 space-y-4">
                  <div>
                    <label className="meta-label block mb-1.5">Title</label>
                    <input
                      required
                      type="text"
                      value={editingQuestion.title}
                      onChange={e => setEditingQuestion({...editingQuestion, title: e.target.value})}
                      className="input-field"
                      placeholder="e.g. Icebreaker"
                    />
                  </div>
                  <div>
                    <label className="meta-label block mb-1.5">Body</label>
                    <textarea
                      required
                      rows={3}
                      value={editingQuestion.body}
                      onChange={e => setEditingQuestion({...editingQuestion, body: e.target.value})}
                      className="input-field resize-none"
                      placeholder="What is your favorite weekend activity?"
                    />
                  </div>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="meta-label block mb-1.5">Timer (sec)</label>
                    <input
                      required
                      type="number"
                      min="5"
                      value={editingQuestion.timer_seconds}
                      onChange={e => setEditingQuestion({...editingQuestion, timer_seconds: parseInt(e.target.value) || 45})}
                      className="input-field"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t-[1.5px] border-line">
                <h3 className="meta-label mb-4">Options</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {editingQuestion.options?.map((opt: any, idx: number) => (
                    <div key={idx} className="flex items-center gap-3">
                      <span className="flex items-center justify-center w-9 h-9 border-[1.5px] border-line rounded-lg font-mono font-bold text-ink-60 shrink-0">
                        {opt.option_key}
                      </span>
                      <input
                        required
                        type="text"
                        value={opt.label}
                        onChange={e => {
                          const newOptions = [...editingQuestion.options]
                          newOptions[idx].label = e.target.value
                          setEditingQuestion({...editingQuestion, options: newOptions})
                        }}
                        className="input-field flex-1"
                        placeholder={`Option ${opt.option_key}`}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-col-reverse sm:flex-row justify-end pt-6 border-t-[1.5px] border-line gap-3">
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => setEditingQuestion(null)}
                  className="btn-ghost px-6 py-2.5"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="btn-primary px-6 py-2.5"
                >
                  <Save className="w-4 h-4" />
                  {loading ? 'Saving...' : 'Save Question'}
                </button>
              </div>
            </form>
          </div>
        )
      )}
    </div>
  )
}
