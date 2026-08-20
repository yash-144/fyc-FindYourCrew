// A hibernating WebSocket only leaves `getWebSockets()` when its underlying
// connection actually terminates — webSocketClose()/webSocketError() fire.
// A client that vanishes without a clean close frame (network drop, backgrounded
// tab, force-quit) never triggers either, so its socket — and its seat in the
// participant count — lingers forever. The client pings periodically; anything
// that goes quiet longer than STALE_TIMEOUT_MS gets swept and force-closed on
// a recurring alarm, which only stays armed while at least one socket is open.

const STALE_TIMEOUT_MS = 75_000; // ~3 missed client pings (client pings every 25s)
const SWEEP_INTERVAL_MS = 30_000;
const IDLE_TIMEOUT_CLOSE_CODE = 4000; // not 1000 — the client should reconnect, not treat this as intentional

interface Attachment {
  lastSeen: number;
}

export class EventRoom {
  state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected Upgrade: websocket', { status: 426 });
    }

    const { 0: client, 1: server } = new WebSocketPair();
    this.state.acceptWebSocket(server);
    server.serializeAttachment({ lastSeen: Date.now() } satisfies Attachment);

    // Arm the sweep only when it isn't already running — a fresh connection
    // shouldn't reset an existing cycle, just make sure one exists.
    if ((await this.state.storage.getAlarm()) === null) {
      await this.state.storage.setAlarm(Date.now() + SWEEP_INTERVAL_MS);
    }

    // Broadcast updated count after the new socket is accepted
    const count = this.state.getWebSockets().length;
    console.log(`[EventRoom] New connection. Total: ${count}`);
    this.broadcastParticipantCount();

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      const data = JSON.parse(message as string);
      ws.serializeAttachment({ lastSeen: Date.now() } satisfies Attachment);

      if (data.type === 'ping') {
        return; // liveness signal only — the attachment refresh above is the point
      } else if (data.type === 'broadcast') {
        this.broadcast(JSON.stringify(data.payload));
      } else if (data.type === 'join') {
        // Client is ready — send it the current count
        const count = this.state.getWebSockets().length;
        console.log(`[EventRoom] Join received, sending count: ${count}`);
        ws.send(JSON.stringify({ type: 'participant_count', payload: count }));
      }
    } catch (err) {
      console.error('[EventRoom] Message parse error', err);
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    // Complete the close handshake
    try { ws.close(code, 'Closing'); } catch (_) {}

    // IMPORTANT: During webSocketClose, the closing socket is STILL in getWebSockets().
    // We must exclude it manually to get the correct remaining count.
    const remaining = this.state.getWebSockets().filter(s => s !== ws);
    const count = remaining.length;
    console.log(`[EventRoom] Connection closed (code=${code}). Remaining: ${count}`);

    // Broadcast only to the remaining sockets (not the one that just closed)
    const msg = JSON.stringify({ type: 'participant_count', payload: count });
    for (const sock of remaining) {
      try { sock.send(msg); } catch (_) {}
    }
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error('[EventRoom] WebSocket error:', error);
    try { ws.close(1011, 'Error'); } catch (_) {}

    // Same logic: exclude the erroring socket from count and broadcast
    const remaining = this.state.getWebSockets().filter(s => s !== ws);
    const count = remaining.length;
    console.log(`[EventRoom] After error. Remaining: ${count}`);

    const msg = JSON.stringify({ type: 'participant_count', payload: count });
    for (const sock of remaining) {
      try { sock.send(msg); } catch (_) {}
    }
  }

  // Sweeps for sockets that have gone quiet longer than STALE_TIMEOUT_MS and
  // force-closes them (webSocketClose does the count cleanup/broadcast for
  // free). Reschedules itself only while connections remain, so an idle room
  // costs nothing between alarms and stops costing anything at all once empty.
  async alarm(): Promise<void> {
    const now = Date.now();
    let evicted = 0;
    for (const ws of this.state.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as Attachment | null;
      const lastSeen = attachment?.lastSeen ?? 0;
      if (now - lastSeen > STALE_TIMEOUT_MS) {
        evicted += 1;
        try { ws.close(IDLE_TIMEOUT_CLOSE_CODE, 'Idle timeout'); } catch (_) {}
      }
    }
    if (evicted > 0) {
      console.log(`[EventRoom] Alarm swept ${evicted} stale connection(s)`);
    }

    if (this.state.getWebSockets().length > 0) {
      await this.state.storage.setAlarm(Date.now() + SWEEP_INTERVAL_MS);
    }
  }

  broadcastParticipantCount() {
    const count = this.state.getWebSockets().length;
    console.log(`[EventRoom] Broadcasting count: ${count}`);
    this.broadcast(JSON.stringify({ type: 'participant_count', payload: count }));
  }

  broadcast(message: string) {
    for (const ws of this.state.getWebSockets()) {
      try { ws.send(message); } catch (_) {}
    }
  }
}
