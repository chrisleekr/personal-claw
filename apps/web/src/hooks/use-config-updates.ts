'use client';

import { useEffect, useRef } from 'react';

interface ConfigChangeEvent {
  channelId: string;
  changeType: string;
  timestamp: number;
}

// NEXT_PUBLIC_API_URL is intentionally used here for the WebSocket connection.
// REST API calls go through /api/proxy instead — see apps/web/src/app/api/proxy/.
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

function deriveWsUrl(httpUrl: string): string {
  const url = new URL(httpUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/ws/config-updates';
  return url.toString();
}

const WS_BASE_URL = deriveWsUrl(API_URL);

const MAX_RECONNECT_DELAY_MS = 30_000;
const BASE_RECONNECT_DELAY_MS = 1_000;
/** WebSocket close code indicating session expiry (server-side). */
const WS_CLOSE_SESSION_EXPIRED = 4001;

/**
 * Obtains a single-use, time-limited WebSocket ticket from the backend
 * via the authenticated Next.js proxy.
 * @returns The ticket string, or null if the request fails.
 */
async function fetchWsTicket(): Promise<string | null> {
  try {
    const res = await fetch('/api/proxy/api/ws-ticket');
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: { ticket?: string } };
    return json.data?.ticket ?? null;
  } catch {
    return null;
  }
}

/**
 * Subscribes to real-time config change events from the backend.
 * Obtains a short-lived ticket via the authenticated proxy, then
 * connects to the WebSocket with that ticket. API_SECRET is never
 * exposed to the browser.
 * Calls `onUpdate` whenever a change matching `channelId` is received.
 */
export function useConfigUpdates(
  channelId: string | undefined,
  onUpdate: (event: ConfigChangeEvent) => void,
): void {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    if (!channelId) return;

    let ws: WebSocket | null = null;
    let reconnectAttempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let unmounted = false;

    async function connect() {
      if (unmounted) return;

      const ticket = await fetchWsTicket();
      if (!ticket || unmounted) {
        // Retry after delay if ticket fetch fails
        const delay = Math.min(
          BASE_RECONNECT_DELAY_MS * 2 ** reconnectAttempt,
          MAX_RECONNECT_DELAY_MS,
        );
        reconnectAttempt++;
        reconnectTimer = setTimeout(connect, delay);
        return;
      }

      ws = new WebSocket(`${WS_BASE_URL}?ticket=${ticket}`);

      ws.onopen = () => {
        reconnectAttempt = 0;
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string) as ConfigChangeEvent;
          if (data.channelId === channelId) {
            onUpdateRef.current(data);
          }
        } catch {
          // malformed message — ignore
        }
      };

      ws.onclose = (event) => {
        if (unmounted) return;
        // On session expiry, reconnect immediately with fresh ticket
        const delay =
          event.code === WS_CLOSE_SESSION_EXPIRED
            ? 0
            : Math.min(BASE_RECONNECT_DELAY_MS * 2 ** reconnectAttempt, MAX_RECONNECT_DELAY_MS);
        reconnectAttempt++;
        reconnectTimer = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        ws?.close();
      };
    }

    connect();

    return () => {
      unmounted = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [channelId]);
}
