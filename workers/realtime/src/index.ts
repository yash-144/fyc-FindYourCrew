import * as jose from 'jose';
export { EventRoom } from './EventRoom';
export { GroupChat } from './GroupChat';

export interface Env {
  EVENT_ROOM: DurableObjectNamespace;
  GROUP_CHAT: DurableObjectNamespace;
  SUPABASE_URL: string;
}

// Cache the JWKS at module level — it's re-fetched automatically when keys rotate
let JWKS: ReturnType<typeof jose.createRemoteJWKSet> | null = null;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const token = url.searchParams.get('token');

    if (!token) {
      return new Response('Missing token', { status: 401 });
    }

    const supabaseUrl = env.SUPABASE_URL || 'https://moayhocwrkasfzkmkdwn.supabase.co';

    if (!JWKS) {
      JWKS = jose.createRemoteJWKSet(
        new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`)
      );
    }

    try {
      await jose.jwtVerify(token, JWKS);
    } catch (err) {
      console.log('[Worker] JWT verification failed:', err);
      return new Response('Invalid token', { status: 401 });
    }

    if (url.pathname.startsWith('/ws/event/')) {
      const eventId = url.pathname.split('/')[3];
      if (!eventId) return new Response('Missing event ID', { status: 400 });

      console.log(`[Worker] Routing to EventRoom for eventId=${eventId}`);
      const id = env.EVENT_ROOM.idFromName(eventId);
      const stub = env.EVENT_ROOM.get(id);
      return stub.fetch(request);
    }

    if (url.pathname.startsWith('/ws/group/')) {
      const groupId = url.pathname.split('/')[3];
      if (!groupId) return new Response('Missing group ID', { status: 400 });

      const id = env.GROUP_CHAT.idFromName(groupId);
      const stub = env.GROUP_CHAT.get(id);
      return stub.fetch(request);
    }

    return new Response('Not Found', { status: 404 });
  }
};
