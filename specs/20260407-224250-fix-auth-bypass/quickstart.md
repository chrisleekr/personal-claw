# Developer Quickstart: Fix Auth Bypass

## Prerequisites

- Bun 1.3.9+
- PostgreSQL with existing PersonalClaw schema
- `API_SECRET` environment variable set (>= 32 chars)

## What Changed

This feature fixes 5 auth/authz bypass vectors. Here's how to work with each:

### 1. WebSocket Authentication

**Before**: Connect without credentials.
**After**: Obtain a short-lived ticket via the API proxy, then connect with it. `API_SECRET` is NEVER sent to the browser.

```typescript
// Frontend connection flow (apps/web)
// Step 1: Obtain ticket via authenticated proxy
const res = await fetch('/api/proxy/ws-ticket');
const { data: { ticket } } = await res.json();

// Step 2: Connect WebSocket with ticket
const ws = new WebSocket(`ws://${host}/ws/config-updates?ticket=${ticket}`);

// Step 3: Subscribe to specific channels after connect
ws.onopen = () => {
  ws.send(JSON.stringify({ type: 'subscribe', channelIds: ['channel-uuid'] }));
};
```

### 2. Scoped Plan Approval

**Before**: One approval → all tools forever.
**After**: Approval scoped to plan tools + timeout.

```typescript
// Channel config: set custom timeout (default 10 min)
await fetch('/api/channels/uuid', {
  method: 'PUT',
  body: JSON.stringify({ approvalTimeoutMs: 300000 }), // 5 min
});
```

### 3. CLI Tools Approval

**Before**: `aws_cli`, `github_cli`, `curl_fetch` auto-approved.
**After**: These go through the approval gateway.

```typescript
// To restore auto-approval for a channel:
await fetch('/api/approvals', {
  method: 'POST',
  body: JSON.stringify({
    channelId: 'channel-uuid',
    toolName: 'aws_cli',
    policy: 'auto',
  }),
});
```

### 4. Channel Ownership on CRUD

**Before**: `DELETE /api/memories/:id` — any authenticated user.
**After**: `DELETE /api/memories/:id?channelId=uuid` — must match entity's channel.

All mutation endpoints now require `channelId` and verify it matches the entity.

### 5. Slash Command Permissions

**Before**: Any channel member runs any command.
**After**: `model` and `compact` require admin.

```text
/pclaw admin add U12345      # Add admin (admin-only)
/pclaw admin remove U12345   # Remove admin (admin-only)
/pclaw admin list             # List admins (anyone)
```

First user to interact with a channel is auto-assigned as admin.

## Running Tests

```bash
# Run all tests
bun test

# Run specific test files for this feature
bun test apps/api/src/__tests__/ws-auth.test.ts
bun test apps/api/src/__tests__/approval-gateway-scoped.test.ts
bun test apps/api/src/__tests__/route-ownership.test.ts
bun test apps/api/src/__tests__/slash-command-perms.test.ts
```

## Quality Check

```bash
bun run check  # typecheck + lint + test
```

## Migration

```bash
cd packages/db
bun run db:generate  # Generate Drizzle migration
bun run db:migrate   # Apply migration
```

The migration adds two columns to `channels` with defaults — no data backfill needed. Existing channels get `approval_timeout_ms = 600000` and `channel_admins = []`.

## Key Files Modified

| File | Change |
|------|--------|
| `apps/api/src/index.ts` | WebSocket ticket validation before upgrade |
| `apps/api/src/routes/ws-ticket.ts` | NEW: Short-lived WS ticket endpoint |
| `apps/web/src/app/api/proxy/ws-ticket/route.ts` | NEW: Proxy route to obtain WS ticket |
| `apps/api/src/agent/approval-gateway.ts` | Scoped plan approval, remove safe tool bypass |
| `apps/api/src/agent/tool-providers.ts` | Remove CLI tools from safe list |
| `apps/api/src/config/hot-reload.ts` | Channel-scoped broadcasts |
| `apps/api/src/routes/memories.ts` | Channel ownership checks |
| `apps/api/src/routes/approvals.ts` | Channel ownership checks |
| `apps/api/src/routes/schedules.ts` | Channel ownership checks |
| `apps/api/src/routes/skills.ts` | Channel ownership checks |
| `apps/api/src/routes/mcp.ts` | Channel ownership checks |
| `apps/api/src/platforms/slack/slash-commands.ts` | Permission tiers |
| `packages/db/src/schema/channels.ts` | New columns |
| `packages/shared/src/constants.ts` | Command permission tiers |
