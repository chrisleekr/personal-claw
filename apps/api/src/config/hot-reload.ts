import { getLogger } from '@logtape/logtape';
import type { ServerWebSocket } from 'bun';
import { errorDetails } from '../utils/error-fmt';

const logger = getLogger(['personalclaw', 'config', 'hot-reload']);

type ConfigChangeHandler = (channelId: string, changeType: string) => void;

const handlers: ConfigChangeHandler[] = [];

export function onConfigChange(handler: ConfigChangeHandler): void {
  handlers.push(handler);
}

// ---------------------------------------------------------------------------
// WebSocket hub – broadcasts config changes to connected dashboard clients
// ---------------------------------------------------------------------------

const wsClients = new Set<ServerWebSocket<unknown>>();

const HEARTBEAT_MS = 30_000;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

function startHeartbeat(): void {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    for (const ws of wsClients) {
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

function addClient(ws: ServerWebSocket<unknown>): void {
  wsClients.add(ws);
  logger.debug`WebSocket client connected (total: ${wsClients.size})`;
  if (wsClients.size === 1) startHeartbeat();
}

function removeClient(ws: ServerWebSocket<unknown>): void {
  wsClients.delete(ws);
  logger.debug`WebSocket client disconnected (total: ${wsClients.size})`;
  if (wsClients.size === 0) stopHeartbeat();
}

function broadcastToClients(channelId: string, changeType: string): void {
  if (wsClients.size === 0) return;
  const payload = JSON.stringify({ channelId, changeType, timestamp: Date.now() });
  for (const ws of wsClients) {
    try {
      ws.send(payload);
    } catch (error) {
      logger.warn('Failed to send WebSocket message, removing client', errorDetails(error));
      wsClients.delete(ws);
    }
  }
}

export const configWsHandler = {
  open(ws: ServerWebSocket<unknown>) {
    addClient(ws);
  },
  message(_ws: ServerWebSocket<unknown>, _message: string | Buffer) {
    // no client-to-server messages expected
  },
  close(ws: ServerWebSocket<unknown>) {
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
