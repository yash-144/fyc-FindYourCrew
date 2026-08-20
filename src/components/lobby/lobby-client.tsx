'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { useRealtime, type RosterEntry } from '@/hooks/use-realtime'
import { signOut } from '@/app/auth/actions'
import { ColorBag, Crewmate, seeded, type CrewColor } from './crewmate'
import { Vent } from './vent'

const LOBBY_STATUSES = new Set(['SETUP', 'LOBBY', 'COUNTDOWN'])
const MAX_VISIBLE = 14
const QUEUE_STAGGER_MS = 550

// Hand-placed organic cluster — deliberately not a grid or a perfect circle.
// {x%, y%, rotateDeg, scale}. y increases toward the vent (bottom, "closer").
const SLOTS = [
  { x: 34, y: 46, r: -6, s: 1.0 },
  { x: 54, y: 33, r: 4, s: 1.05 },
  { x: 68, y: 50, r: -3, s: 0.95 },
  { x: 44, y: 60, r: 5, s: 1.0 },
  { x: 60, y: 66, r: -8, s: 0.92 },
  { x: 26, y: 60, r: 2, s: 0.95 },
  { x: 74, y: 34, r: -4, s: 1.0 },
  { x: 40, y: 26, r: 6, s: 0.88 },
  { x: 61, y: 44, r: -2, s: 1.0 },
  { x: 30, y: 38, r: 3, s: 0.9 },
  { x: 78, y: 58, r: -5, s: 0.9 },
  { x: 48, y: 47, r: 4, s: 0.98 },
  { x: 22, y: 48, r: -3, s: 0.92 },
  { x: 67, y: 22, r: 5, s: 0.86 },
] as const

const VENT_POS = { x: 50, y: 92 }

// Spring constants (critical damping at these stiffness values is ~2*sqrt(k)).
// Deliberately underdamped so arrivals overshoot and settle rather than glide
// to a stop — that's the "bounce" — while staying well clear of oscillating.
const POS_STIFFNESS = 90
const POS_DAMPING = 12
const SCALE_STIFFNESS = 120
const SCALE_DAMPING = 14

interface Seat extends RosterEntry {
  slot: number
  color: CrewColor
}

interface Physics {
  x: number
  y: number
  vx: number
  vy: number
  scale: number
  vscale: number
  freqY: number
  ampY: number
  phaseY: number
  freqR: number
  ampR: number
  phaseR: number
}

export function LobbyClient({
  eventId,
  selfParticipantId,
  selfName,
  selfAvatarUrl,
}: {
  eventId: string
  selfParticipantId: string
  selfName?: string | null
  selfAvatarUrl?: string | null
}) {
  const router = useRouter()
  const identity = useRef({ participantId: selfParticipantId, name: selfName || 'Crewmate' }).current
  const { roster, eventUpdate } = useRealtime(eventId, undefined, identity)

  const [seats, setSeats] = useState<Seat[]>([])
  const [overflow, setOverflow] = useState(0)
  const [ventOpen, setVentOpen] = useState(false)
  const [totalCount, setTotalCount] = useState(0)

  const stageRef = useRef<HTMLDivElement>(null)
  const stageSizeRef = useRef({ w: 640, h: 400 })
  const seatsRef = useRef<Seat[]>([])
  const crewElsRef = useRef<Map<string, HTMLDivElement>>(new Map())
  const physicsRef = useRef<Map<string, Physics>>(new Map())
  const reducedMotionRef = useRef(false)

  const knownIds = useRef<Set<string>>(new Set())
  const queueRef = useRef<RosterEntry[]>([])
  const processingRef = useRef(false)
  const usedSlots = useRef<Set<number>>(new Set())
  const colorBagRef = useRef(new ColorBag())

  useEffect(() => {
    seatsRef.current = seats
  }, [seats])

  // Measure the stage in real pixels — the physics sim runs in pixel space so
  // arrivals travel a real distance from the vent, and it stays correct
  // through any resize without needing to restart an animation.
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      stageSizeRef.current = { w: entry.contentRect.width, h: entry.contentRect.height }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    reducedMotionRef.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }, [])

  // The single animation loop: every seated crewmate is a damped spring
  // chasing its slot, plus a small continuous idle sway. Writes transforms
  // directly to the DOM via refs — no React re-render, no CSS keyframe, so
  // there's nothing else fighting over `transform` and nothing to desync.
  useEffect(() => {
    let raf = 0
    let last = performance.now()

    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.032)
      last = now
      const stage = stageSizeRef.current
      const reduced = reducedMotionRef.current
      const kPos = reduced ? 400 : POS_STIFFNESS
      const cPos = reduced ? 40 : POS_DAMPING
      const kScale = reduced ? 400 : SCALE_STIFFNESS
      const cScale = reduced ? 40 : SCALE_DAMPING
      const t = now / 1000

      for (const seat of seatsRef.current) {
        const phys = physicsRef.current.get(seat.participantId)
        const slot = SLOTS[seat.slot]
        if (!phys || !slot) continue

        const targetX = (slot.x / 100) * stage.w
        const targetY = (slot.y / 100) * stage.h

        const ax = (targetX - phys.x) * kPos - phys.vx * cPos
        phys.vx += ax * dt
        phys.x += phys.vx * dt

        const ay = (targetY - phys.y) * kPos - phys.vy * cPos
        phys.vy += ay * dt
        phys.y += phys.vy * dt

        const as = (slot.s - phys.scale) * kScale - phys.vscale * cScale
        phys.vscale += as * dt
        phys.scale += phys.vscale * dt

        const bobY = reduced ? 0 : Math.sin(t * phys.freqY + phys.phaseY) * phys.ampY
        const bobR = reduced ? 0 : Math.sin(t * phys.freqR + phys.phaseR) * phys.ampR

        const el = crewElsRef.current.get(seat.participantId)
        if (el) {
          el.style.transform =
            `translate(${phys.x}px, ${phys.y + bobY}px) translate(-50%, -50%) ` +
            `rotate(${slot.r + bobR}deg) scale(${Math.max(phys.scale, 0)})`
        }
      }

      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const nextFreeSlot = useCallback(() => {
    for (let i = 0; i < SLOTS.length; i += 1) {
      if (!usedSlots.current.has(i)) return i
    }
    return null
  }, [])

  // Drain the arrival queue one crewmate at a time: open the vent, spawn
  // their physics state at the vent's position (the spring itself carries
  // them up to their slot — no separate "entrance animation" needed), pace
  // the next one a beat later so simultaneous joins don't all pop at once.
  const processQueue = useCallback(() => {
    if (processingRef.current) return
    const next = queueRef.current.shift()
    if (!next) return
    const slot = nextFreeSlot()
    if (slot === null) {
      // Shouldn't happen — the roster effect only queues as many arrivals as
      // there's capacity for — but stay defensive rather than seat past
      // MAX_VISIBLE. Overflow count itself is owned (and recomputed fresh)
      // by that effect, not incremented here.
      return
    }
    processingRef.current = true
    usedSlots.current.add(slot)
    setVentOpen(true)

    const stage = stageSizeRef.current
    physicsRef.current.set(next.participantId, {
      x: (VENT_POS.x / 100) * stage.w,
      y: (VENT_POS.y / 100) * stage.h,
      vx: 0,
      vy: -140, // a little upward kick, like popping through the hatch
      scale: 0.35,
      vscale: 0,
      freqY: 0.32 + seeded(next.participantId, 'freqY') * 0.28,
      ampY: 2 + seeded(next.participantId, 'ampY') * 1.6,
      phaseY: seeded(next.participantId, 'phaseY') * Math.PI * 2,
      freqR: 0.24 + seeded(next.participantId, 'freqR') * 0.22,
      ampR: 1.4 + seeded(next.participantId, 'ampR') * 1.6,
      phaseR: seeded(next.participantId, 'phaseR') * Math.PI * 2,
    })
    setSeats((prev) => [...prev, { ...next, slot, color: colorBagRef.current.next() }])

    window.setTimeout(() => setVentOpen(false), 450)
    window.setTimeout(() => {
      processingRef.current = false
      processQueue()
    }, QUEUE_STAGGER_MS)
  }, [nextFreeSlot])

  // Driven by the realtime worker's live roster (who is actually connected
  // right now), not a poll of permanent DB membership — so someone who
  // joined and later dropped off (idle-swept, closed the tab, network drop)
  // disappears from the scene instead of lingering there forever.
  useEffect(() => {
    const freshIds = new Set(roster.map((r) => r.participantId))

    // Departures — free the slot/physics/DOM state for anyone no longer live.
    setSeats((prev) => {
      const remaining = prev.filter((s) => freshIds.has(s.participantId))
      if (remaining.length === prev.length) return prev
      for (const s of prev) {
        if (!freshIds.has(s.participantId)) {
          usedSlots.current.delete(s.slot)
          physicsRef.current.delete(s.participantId)
          crewElsRef.current.delete(s.participantId)
        }
      }
      return remaining
    })
    for (const id of knownIds.current) {
      if (!freshIds.has(id)) knownIds.current.delete(id)
    }
    queueRef.current = queueRef.current.filter((r) => freshIds.has(r.participantId))

    // Arrivals — anyone new gets queued for the vent-emergence animation.
    const arrivals = roster.filter((r) => !knownIds.current.has(r.participantId))
    for (const r of arrivals) knownIds.current.add(r.participantId)
    if (arrivals.length > 0) {
      const capacityLeft = Math.max(0, MAX_VISIBLE - usedSlots.current.size - queueRef.current.length)
      queueRef.current.push(...arrivals.slice(0, capacityLeft))
      processQueue()
    }

    setOverflow(Math.max(0, roster.length - usedSlots.current.size - queueRef.current.length))
    setTotalCount(roster.length)
  }, [roster, processQueue])

  // The admin's broadcast already carries the new status — no need to ask
  // /api/event-state for it separately (that's the exact fetch-storm this
  // page used to trigger on every single connected participant at once).
  useEffect(() => {
    const status = eventUpdate?.eventState?.status
    if (!status || LOBBY_STATUSES.has(status)) return
    if (status === 'GROUP_CHAT_OPEN') {
      router.push('/chat')
    } else {
      router.push('/event')
    }
  }, [eventUpdate, router])

  return (
    <div className="crew-room relative flex-1 flex flex-col min-h-dvh overflow-hidden">
      {/* minimal corner chrome — the scene is the UI */}
      <div className="absolute top-0 inset-x-0 z-20 flex items-center justify-between px-4 sm:px-6 py-4">
        <div className="font-mono text-[0.65rem] tracking-[0.2em] uppercase text-white/50">
          ✳ Find Your Crew
        </div>
        <div className="flex items-center gap-3">
          {selfName && (
            <span className="font-mono text-[0.65rem] tracking-wider uppercase text-white/60 hidden sm:inline">
              {selfName}
            </span>
          )}
          <form action={signOut}>
            <button type="submit" className="p-1.5 text-white/40 hover:text-red transition-colors" title="Sign out">
              <LogOut className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>

      {/* the stage */}
      <div ref={stageRef} className="relative flex-1 w-full max-w-3xl mx-auto">
        {seats.map((seat) => {
          const slot = SLOTS[seat.slot]!
          return (
            <div
              key={seat.participantId}
              ref={(el) => {
                if (el) crewElsRef.current.set(seat.participantId, el)
                else crewElsRef.current.delete(seat.participantId)
              }}
              className="absolute left-0 top-0 flex flex-col items-center gap-1"
              style={{ zIndex: Math.round(slot.y), willChange: 'transform' }}
            >
              <Crewmate color={seat.color} />
              <span className="font-mono text-[0.6rem] uppercase tracking-wide text-white/70 bg-black/40 px-1.5 py-0.5 rounded whitespace-nowrap">
                {seat.name.split(' ')[0]}
              </span>
            </div>
          )
        })}

        {overflow > 0 && (
          <div
            className="absolute font-mono text-xs text-white/60 border border-white/20 rounded-full px-2.5 py-1"
            style={{ left: '88%', top: '18%', transform: 'translate(-50%,-50%)' }}
          >
            +{overflow} more
          </div>
        )}

        <div className="absolute left-1/2 bottom-[4%] -translate-x-1/2">
          <Vent open={ventOpen} />
        </div>
      </div>

      {/* minimal status line */}
      <div className="relative z-10 pb-8 sm:pb-10 flex flex-col items-center gap-2 text-center px-6">
        <div className="font-display font-bold text-3xl sm:text-4xl text-white tabular-nums">
          {totalCount} <span className="text-red">CREW</span>
        </div>
        <div className="font-mono text-[0.7rem] tracking-[0.2em] uppercase text-white/50">
          Hang tight — we&rsquo;ll jump in the moment it starts.
        </div>
      </div>
    </div>
  )
}
