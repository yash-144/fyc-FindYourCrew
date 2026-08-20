'use client'

import { useEffect, useState, useRef } from 'react'

export interface RosterEntry {
  participantId: string
  name: string
}

export interface RealtimeIdentity {
  participantId: string
  name: string
}

export function useRealtime(eventId: string, groupId?: string, identity?: RealtimeIdentity) {
  const [messages, setMessages] = useState<any[]>([])
  const [connected, setConnected] = useState(false)
  const [participantCount, setParticipantCount] = useState(0)
  const [roster, setRoster] = useState<RosterEntry[]>([])
  const [refreshTrigger, setRefreshTrigger] = useState(0)
  const wsRef = useRef<WebSocket | null>(null)

  // Identity can arrive a tick after eventId/groupId (it's derived from a
  // participant row fetched by the parent). Keep a ref so the reconnect
  // effect below doesn't need identity in its dependency array — that would
  // tear down and reopen the socket every time the identity object's
  // reference changes, even when its contents didn't.
  const identityRef = useRef(identity)
  identityRef.current = identity

  useEffect(() => {
    let mounted = true
    let activeWs: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let pingInterval: ReturnType<typeof setInterval> | null = null
    let retryDelay = 1000

    // Keeps the Durable Object's liveness check happy — without this, an
    // idle-but-still-open tab (nothing to broadcast, just sitting in the
    // lobby) would look identical to an abandoned connection and get swept.
    const PING_INTERVAL_MS = 25_000

    const connect = async () => {
      if (!mounted) return
      try {
        const res = await fetch('/api/realtime/auth')
        if (!res.ok) return
        const { token } = await res.json()
        if (!mounted) return

        const path = groupId ? `/ws/group/${groupId}` : `/ws/event/${eventId}`
        const baseUrl = process.env.NEXT_PUBLIC_REALTIME_URL || 'wss://crew-match-realtime.goyalyash144.workers.dev'
        const wsUrl = new URL(`${baseUrl}${path}`)
        wsUrl.searchParams.set('eventId', eventId)
        wsUrl.searchParams.set('token', token)

        const ws = new WebSocket(wsUrl)
        activeWs = ws
        wsRef.current = ws

        ws.onopen = () => {
          console.log('[Realtime] Connected')
          retryDelay = 1000 // reset backoff on success
          if (mounted) setConnected(true)
          const id = identityRef.current
          ws.send(JSON.stringify(id ? { type: 'join', participantId: id.participantId, name: id.name } : { type: 'join' }))

          if (pingInterval) clearInterval(pingInterval)
          pingInterval = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'ping' }))
            }
          }, PING_INTERVAL_MS)
        }

        ws.onmessage = (event) => {
          if (!mounted) return
          try {
            const data = JSON.parse(event.data)
            if (data.type === 'chat_message') {
              setMessages(prev => [...prev, data.payload])
            } else if (data.type === 'participant_count') {
              setParticipantCount(data.payload)
            } else if (data.type === 'roster') {
              setRoster(data.payload)
            } else if (data.type === 'event_state_update') {
              setRefreshTrigger(prev => prev + 1)
            }
          } catch (e) {
            console.error('WebSocket parse error', e)
          }
        }

        ws.onclose = (e) => {
          console.log(`[Realtime] Disconnected (code=${e.code})`)
          if (pingInterval) {
            clearInterval(pingInterval)
            pingInterval = null
          }
          if (mounted) {
            setConnected(false)
            // Reconnect unless we closed it intentionally (code 1000)
            if (e.code !== 1000) {
              reconnectTimer = setTimeout(() => {
                retryDelay = Math.min(retryDelay * 2, 30000)
                connect()
              }, retryDelay)
            }
          }
        }
      } catch (err) {
        console.error('Realtime connect error', err)
        if (mounted) {
          reconnectTimer = setTimeout(() => {
            retryDelay = Math.min(retryDelay * 2, 30000)
            connect()
          }, retryDelay)
        }
      }
    }

    // Ensure a clean close frame is sent when the tab is closed
    const handleBeforeUnload = () => {
      if (activeWs && activeWs.readyState === WebSocket.OPEN) {
        activeWs.close(1000, 'Tab closed')
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)

    connect()

    return () => {
      mounted = false
      window.removeEventListener('beforeunload', handleBeforeUnload)
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (pingInterval) clearInterval(pingInterval)
      if (activeWs) activeWs.close(1000, 'Component unmounted')
    }
  }, [eventId, groupId])

  const broadcastChat = (message: any) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
       wsRef.current.send(JSON.stringify({ type: 'broadcast', payload: { type: 'chat_message', payload: message } }))
    }
  }

  const broadcastEvent = (payload: any) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
       wsRef.current.send(JSON.stringify({ type: 'broadcast', payload }))
    }
  }

  return { connected, messages, broadcastChat, broadcastEvent, participantCount, roster, refreshTrigger }
}
