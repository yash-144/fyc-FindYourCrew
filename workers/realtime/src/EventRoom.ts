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

    // Broadcast updated count after the new socket is accepted
    const count = this.state.getWebSockets().length;
    console.log(`[EventRoom] New connection. Total: ${count}`);
    this.broadcastParticipantCount();

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      const data = JSON.parse(message as string);
      if (data.type === 'broadcast') {
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
