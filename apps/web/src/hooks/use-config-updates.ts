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

const WS_URL = deriveWsUrl(API_URL);

const MAX_RECONNECT_DELAY_MS = 30_000;
const BASE_RECONNECT_DELAY_MS = 1_000;

/**
 * Subscribes to real-time config change events from the backend.
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

    function connect() {
      if (unmounted) return;

      ws = new WebSocket(WS_URL);

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

      ws.onclose = () => {
        if (unmounted) return;
        const delay = Math.min(
          BASE_RECONNECT_DELAY_MS * 2 ** reconnectAttempt,
          MAX_RECONNECT_DELAY_MS,
        );
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
