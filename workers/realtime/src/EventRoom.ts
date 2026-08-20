// A hibernating WebSocket only leaves `getWebSockets()` when its underlying
// connection actually terminates — webSocketClose()/webSocketError() fire.
// A client that vanishes without a clean close frame (network drop, backgrounded
// tab, force-quit) never triggers either, so its socket — and its seat in the
// participant count — lingers forever. The client pings periodically; anything
// that goes quiet longer than STALE_TIMEOUT_MS gets swept and force-closed on
// a recurring alarm, which only stays armed while at least one socket is open.
//
// Every socket also carries the participant's identity (attached on `join`),
// so this room can broadcast an actual live roster — not just a count. That's
// what the lobby's crew-assembly scene is driven by: participants who leave
// (idle-swept or genuinely disconnected) drop out of the next broadcast, so
// the lobby stops showing people who joined in a past session and left.

const STALE_TIMEOUT_MS = 75_000; // ~3 missed client pings (client pings every 25s)
const SWEEP_INTERVAL_MS = 30_000;
const IDLE_TIMEOUT_CLOSE_CODE = 4000; // not 1000 — the client should reconnect, not treat this as intentional

interface Attachment {
  lastSeen: number;
  firstSeen: number;
  participantId?: string;
  name?: string;
}

interface RosterEntry {
  participantId: string;
  name: string;
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
    const now = Date.now();
    server.serializeAttachment({ lastSeen: now, firstSeen: now } satisfies Attachment);

    // Arm the sweep only when it isn't already running — a fresh connection
    // shouldn't reset an existing cycle, just make sure one exists.
    if ((await this.state.storage.getAlarm()) === null) {
      await this.state.storage.setAlarm(Date.now() + SWEEP_INTERVAL_MS);
    }

    console.log(`[EventRoom] New connection. Total: ${this.state.getWebSockets().length}`);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      const data = JSON.parse(message as string);
      const attachment = (ws.deserializeAttachment() as Attachment | null) ?? { lastSeen: Date.now(), firstSeen: Date.now() };
      attachment.lastSeen = Date.now();

      if (data.type === 'ping') {
        ws.serializeAttachment(attachment);
        return; // liveness signal only — the lastSeen refresh above is the point
      } else if (data.type === 'broadcast') {
        ws.serializeAttachment(attachment);
        this.broadcast(JSON.stringify(data.payload));
      } else if (data.type === 'join') {
        if (typeof data.participantId === 'string') attachment.participantId = data.participantId;
        if (typeof data.name === 'string') attachment.name = data.name;
        ws.serializeAttachment(attachment);
        console.log(`[EventRoom] Join: ${attachment.name ?? 'unknown'} (${attachment.participantId ?? 'no id'})`);
        this.broadcastRoster();
      }
    } catch (err) {
      console.error('[EventRoom] Message parse error', err);
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    // Complete the close handshake
    try { ws.close(code, 'Closing'); } catch (_) {}
    console.log(`[EventRoom] Connection closed (code=${code}).`);
    this.broadcastRoster(ws);
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error('[EventRoom] WebSocket error:', error);
    try { ws.close(1011, 'Error'); } catch (_) {}
    this.broadcastRoster(ws);
  }

  // Sweeps for sockets that have gone quiet longer than STALE_TIMEOUT_MS and
  // force-closes them (webSocketClose does the roster cleanup/broadcast for
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

  // `excludeWs` — during webSocketClose/webSocketError, the closing socket is
  // still present in getWebSockets(), so it must be filtered out by reference
  // to get the roster as it will be a moment later.
  broadcastRoster(excludeWs?: WebSocket) {
    const entries: (RosterEntry & { firstSeen: number })[] = [];
    for (const ws of this.state.getWebSockets()) {
      if (ws === excludeWs) continue;
      const attachment = ws.deserializeAttachment() as Attachment | null;
      if (attachment?.participantId && attachment.name) {
        entries.push({ participantId: attachment.participantId, name: attachment.name, firstSeen: attachment.firstSeen });
      }
    }
    entries.sort((a, b) => a.firstSeen - b.firstSeen); // stable arrival order for the lobby scene
    const roster: RosterEntry[] = entries.map(({ participantId, name }) => ({ participantId, name }));
    console.log(`[EventRoom] Broadcasting roster: ${roster.length} identified participant(s)`);
    this.broadcast(JSON.stringify({ type: 'roster', payload: roster }));
  }

  broadcast(message: string) {
    for (const ws of this.state.getWebSockets()) {
      try { ws.send(message); } catch (_) {}
    }
  }
}
