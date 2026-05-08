# Data Model Changes: Fix Auth Bypass

## Schema Changes

### channels table — New columns

| Column | Type | Default | Nullable | Description |
|--------|------|---------|----------|-------------|
| `approval_timeout_ms` | `integer` | `600000` | NOT NULL | Per-channel plan approval timeout in milliseconds (10 min default) |
| `channel_admins` | `text[]` | `[]` | NOT NULL | Array of platform user IDs with admin permissions for this channel |

**Migration**: Single migration adding both columns with defaults (non-breaking, no backfill needed).

**Relationships**: No new foreign keys. `channel_admins` stores platform-specific user IDs (e.g., Slack user IDs like `U12345`), matching the existing `allowedUsers` pattern in `approval_policies`.

**Validation rules**:
- `approval_timeout_ms` must be >= 60000 (1 minute minimum) and <= 3600000 (1 hour maximum)
- `channel_admins` array elements must be non-empty strings

## In-Memory State Changes

### PlanApprovalState (new type in approval-gateway.ts)

```text
PlanApprovalState {
  approvedToolNames: Set<string>   — Tool names declared explicitly via the `toolNames` field in confirm_plan
  approvedAt: number               — Unix timestamp when plan was approved
  timeoutMs: number                — Timeout from channel config (approval_timeout_ms)
}
```

**Lifecycle**:
1. Created when user approves a plan via `confirm_plan` tool
2. Checked on every `checkApproval()` call
3. Expired when `Date.now() - approvedAt >= timeoutMs`
4. Replaced when a new plan is approved (fresh state)
5. Cleared when the agent session ends

**State transitions**:

```text
null → PlanApprovalState (on plan approval)
PlanApprovalState → expired (on timeout check)
PlanApprovalState → new PlanApprovalState (on re-approval)
```

### WebSocket Client Map (replaces flat Set in hot-reload.ts)

```text
Current:  wsClients: Set<ServerWebSocket<unknown>>
Proposed: wsClients: Map<string, Set<ServerWebSocket<{ userId?: string }>>>
          Key: channelId
          Value: Set of authenticated WebSocket connections subscribed to that channel
```

**Lifecycle**:
1. Client connects with valid WS ticket (obtained via `/api/ws-ticket` proxy) → upgrade accepted with `{ data: { ticketId } }`
2. Client sends subscription message: `{ type: "subscribe", channelIds: ["uuid1", "uuid2"] }`
3. Server validates channel access, adds connection to channel sets
4. On broadcast: only iterate connections in `wsClients.get(channelId)`
5. On disconnect: remove from all channel sets

### WebSocket Ticket Store (in-memory in ws-ticket.ts)

```text
wsTicketStore: Map<string, { createdAt: number, used: boolean }>
  Key: ticket UUID
  Value: creation timestamp + used flag
  TTL: 60 seconds (tickets expire and are cleaned up)
  Single-use: ticket is marked used on first WebSocket upgrade
```

**Lifecycle**:
1. `GET /api/ws-ticket` (authenticated) → generates UUID ticket, stores with `createdAt`
2. Client connects to WS with `?ticket=<uuid>` → server looks up ticket, validates TTL + not used, marks used, upgrades
3. Periodic cleanup (every 60s) removes expired tickets from the map

### WebSocket Session Max Duration (in hot-reload.ts)

```text
WS_MAX_SESSION_MS: 86400000 (24 hours default)
```

On each heartbeat ping (every 30s), check `Date.now() - connectionOpenedAt > WS_MAX_SESSION_MS`. If exceeded, close the connection with code 4001 (session expired). Client auto-reconnects and obtains a fresh ticket.

## Existing Tables — No Schema Changes

| Table | Impact |
|-------|--------|
| `approval_policies` | No schema change. Route handlers add channel ownership verification. |
| `channel_memories` | No schema change. Route handlers add channel ownership verification. |
| `schedules` | No schema change. Route handlers add channel ownership verification. |
| `skills` | No schema change. Route handlers add channel ownership verification. |
| `mcp_configs` | No schema change. Route handlers add channel ownership verification. |
| `conversations` | No change (already has correct ownership pattern). |
