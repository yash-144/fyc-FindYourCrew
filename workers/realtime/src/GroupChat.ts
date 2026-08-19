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

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      const data = JSON.parse(message as string);
      if (data.type === 'broadcast') {
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
