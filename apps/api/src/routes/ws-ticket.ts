import { getLogger } from '@logtape/logtape';
import { Hono } from 'hono';

const logger = getLogger(['personalclaw', 'routes', 'ws-ticket']);

const WS_TICKET_TTL_MS = 60_000;
const CLEANUP_INTERVAL_MS = 60_000;

interface TicketEntry {
  createdAt: number;
  used: boolean;
}

/** In-memory store for single-use, time-limited WebSocket tickets. */
export const wsTicketStore = new Map<string, TicketEntry>();

/** Validates and consumes a WS ticket. Returns true if valid. */
export function consumeTicket(ticket: string): boolean {
  const entry = wsTicketStore.get(ticket);
  if (!entry) return false;
  if (entry.used) return false;
  if (Date.now() - entry.createdAt > WS_TICKET_TTL_MS) {
    wsTicketStore.delete(ticket);
    return false;
  }
  entry.used = true;
  return true;
}

// Periodic cleanup of expired tickets
setInterval(() => {
  const now = Date.now();
  for (const [ticket, entry] of wsTicketStore) {
    if (now - entry.createdAt > WS_TICKET_TTL_MS) {
      wsTicketStore.delete(ticket);
    }
  }
}, CLEANUP_INTERVAL_MS);

export const wsTicketRoute = new Hono();

wsTicketRoute.get('/', (c) => {
  const ticket = crypto.randomUUID();
  wsTicketStore.set(ticket, { createdAt: Date.now(), used: false });
  logger.debug('Issued WS ticket', { ticket: ticket.slice(0, 8) });
  return c.json({ data: { ticket, expiresIn: WS_TICKET_TTL_MS / 1000 } });
});
