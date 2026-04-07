import { getLogger } from '@logtape/logtape';
import type { ServerWebSocket } from 'bun';
import { z } from 'zod';
import { errorDetails } from '../utils/error-fmt';

const logger = getLogger(['personalclaw', 'config', 'hot-reload']);

/** WebSocket close code for session timeout. */
export const WS_CLOSE_SESSION_EXPIRED = 4001;
const WS_MAX_SESSION_MS = 86_400_000; // 24 hours

export interface WsData {
  connectedAt: number;
}

type ConfigChangeHandler = (channelId: string, changeType: string) => void;

const handlers: ConfigChangeHandler[] = [];

export function onConfigChange(handler: ConfigChangeHandler): void {
  handlers.push(handler);
}

// ---------------------------------------------------------------------------
// WebSocket hub – channel-scoped config change broadcasting
// ---------------------------------------------------------------------------

/** All connected clients (for heartbeat/session management). */
const allClients = new Set<ServerWebSocket<WsData>>();
/** Channel → set of subscribed WebSocket connections. */
const channelSubscriptions = new Map<string, Set<ServerWebSocket<WsData>>>();

const HEARTBEAT_MS = 30_000;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

function startHeartbeat(): void {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    const now = Date.now();
    for (const ws of allClients) {
      const data = ws.data;
      if (data?.connectedAt && now - data.connectedAt > WS_MAX_SESSION_MS) {
        logger.info('Closing expired WebSocket session', {
          connectedAt: data.connectedAt,
          ageMs: now - data.connectedAt,
        });
        ws.close(WS_CLOSE_SESSION_EXPIRED, 'Session expired');
        removeClient(ws);
        continue;
      }
      ws.ping();
    }
  }, HEARTBEAT_MS);
}

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function addClient(ws: ServerWebSocket<WsData>): void {
  allClients.add(ws);
  logger.debug`WebSocket client connected (total: ${allClients.size})`;
  if (allClients.size === 1) startHeartbeat();
}

function removeClient(ws: ServerWebSocket<WsData>): void {
  allClients.delete(ws);
  // Remove from all channel subscriptions
  for (const [channelId, subscribers] of channelSubscriptions) {
    subscribers.delete(ws);
    if (subscribers.size === 0) channelSubscriptions.delete(channelId);
  }
  logger.debug`WebSocket client disconnected (total: ${allClients.size})`;
  if (allClients.size === 0) stopHeartbeat();
}

const subscribeMessageSchema = z.object({
  type: z.literal('subscribe'),
  channelIds: z.array(z.string().uuid()),
});

function handleSubscribe(ws: ServerWebSocket<WsData>, message: string): void {
  try {
    const parsed = subscribeMessageSchema.parse(JSON.parse(message));
    for (const channelId of parsed.channelIds) {
      let subscribers = channelSubscriptions.get(channelId);
      if (!subscribers) {
        subscribers = new Set();
        channelSubscriptions.set(channelId, subscribers);
      }
      subscribers.add(ws);
    }
    logger.debug('Client subscribed to channels', {
      channelCount: parsed.channelIds.length,
    });
  } catch {
    // Ignore malformed messages
  }
}

function broadcastToClients(channelId: string, changeType: string): void {
  const subscribers = channelSubscriptions.get(channelId);
  if (!subscribers || subscribers.size === 0) return;
  const payload = JSON.stringify({ channelId, changeType, timestamp: Date.now() });
  for (const ws of subscribers) {
    try {
      ws.send(payload);
    } catch (error) {
      logger.warn('Failed to send WebSocket message, removing client', errorDetails(error));
      removeClient(ws);
    }
  }
}

export const configWsHandler = {
  open(ws: ServerWebSocket<WsData>) {
    addClient(ws);
  },
  message(ws: ServerWebSocket<WsData>, message: string | Buffer) {
    handleSubscribe(ws, typeof message === 'string' ? message : message.toString());
  },
  close(ws: ServerWebSocket<WsData>) {
    removeClient(ws);
  },
};

// ---------------------------------------------------------------------------

export function emitConfigChange(channelId: string, changeType: string): void {
  logger.info`Config change: channel=${channelId} type=${changeType}`;
  for (const handler of handlers) {
    try {
      handler(channelId, changeType);
    } catch (error) {
      logger.error('Config change handler error', {
        channelId,
        changeType,
        ...errorDetails(error),
      });
    }
  }
  broadcastToClients(channelId, changeType);
}
