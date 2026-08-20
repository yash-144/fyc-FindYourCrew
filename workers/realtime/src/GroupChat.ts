// Same stale-connection sweep as EventRoom — see the comment there for why
// it's needed: a hibernating WebSocket that vanishes without a clean close
// frame never fires webSocketClose() on its own, so it would otherwise sit
// in getWebSockets() (and count toward "N on frequency") forever.

const STALE_TIMEOUT_MS = 75_000; // ~3 missed client pings (client pings every 25s)
const SWEEP_INTERVAL_MS = 30_000;
const IDLE_TIMEOUT_CLOSE_CODE = 4000; // not 1000 — the client should reconnect, not treat this as intentional

interface Attachment {
  lastSeen: number;
}

export class GroupChat {
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

    if ((await this.state.storage.getAlarm()) === null) {
      await this.state.storage.setAlarm(Date.now() + SWEEP_INTERVAL_MS);
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      const data = JSON.parse(message as string);
      ws.serializeAttachment({ lastSeen: Date.now() } satisfies Attachment);

      if (data.type === 'ping') {
        return; // liveness signal only
      } else if (data.type === 'broadcast') {
        this.broadcast(JSON.stringify(data.payload));
      }
    } catch (err) {
      console.error('[GroupChat] Message parse error:', err);
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    ws.close(code, reason);
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error('[GroupChat] WebSocket error:', error);
  }

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
      console.log(`[GroupChat] Alarm swept ${evicted} stale connection(s)`);
    }

    if (this.state.getWebSockets().length > 0) {
      await this.state.storage.setAlarm(Date.now() + SWEEP_INTERVAL_MS);
    }
  }

  broadcast(message: string) {
    for (const ws of this.state.getWebSockets()) {
      try {
        ws.send(message);
      } catch (err) {
        console.error('[GroupChat] Failed to send to client:', err);
      }
    }
  }
}
