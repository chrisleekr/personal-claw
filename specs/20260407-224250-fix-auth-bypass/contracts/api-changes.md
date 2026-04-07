# API Contract Changes: Fix Auth Bypass

## WebSocket Endpoint

### `GET /api/ws-ticket` — NEW: Obtain WebSocket Ticket

**Purpose**: Returns a single-use, time-limited ticket for authenticating WebSocket connections. Called by the frontend via the Next.js proxy (which adds Bearer token server-side).

**Request**: `GET /api/ws-ticket` (requires `Authorization: Bearer <API_SECRET>`)

**Response**:
```json
{ "data": { "ticket": "uuid-string", "expiresIn": 60 } }
```

- Ticket is valid for 60 seconds and can only be used once
- Returns 401 if not authenticated

### `/ws/config-updates` — Authentication Added

**Before**: Any client can connect without credentials.

**After**: Short-lived ticket required as query parameter. The `API_SECRET` is NEVER sent to the browser.

```text
Connection: ws://host/ws/config-updates?ticket=<ws-ticket>
```

- Missing/invalid/expired/used ticket → HTTP 401 (upgrade rejected)
- Valid ticket → upgrade accepted, ticket marked as used
- Connections have a max session duration (24 hours default); expired sessions are closed with code 4001

**Subscription message** (client → server, after connect):
```json
{ "type": "subscribe", "channelIds": ["uuid1", "uuid2"] }
```

**Broadcast message** (server → client, unchanged format):
```json
{ "channelId": "uuid", "changeType": "string", "timestamp": 1234567890 }
```

Only sent to clients subscribed to the matching `channelId`.

---

## CRUD Endpoints — Channel Ownership Required

All mutation endpoints now require `channelId` in the request and verify ownership. Requests targeting entities belonging to a different channel receive `404 Not Found` (not `403`, to prevent enumeration).

### Affected Endpoints

| Method | Path | Change |
|--------|------|--------|
| PATCH | `/api/memories/:id` | Body must include `channelId`; verified against entity |
| DELETE | `/api/memories/:id` | Query param `channelId` required; verified against entity |
| POST | `/api/approvals` | Body `channelId` verified (already present, now validated) |
| PUT | `/api/approvals/:id` | Body must include `channelId`; verified against entity |
| DELETE | `/api/approvals/:id` | Query param `channelId` required; verified against entity |
| POST | `/api/schedules` | Body `channelId` verified |
| PUT | `/api/schedules/:id` | Body must include `channelId`; verified against entity |
| DELETE | `/api/schedules/:id` | Query param `channelId` required; verified against entity |
| POST | `/api/skills` | Body `channelId` verified |
| PUT | `/api/skills/:id` | Body must include `channelId`; verified against entity |
| DELETE | `/api/skills/:id` | Query param `channelId` required; verified against entity |
| POST | `/api/mcp` | Body `channelId` verified |
| PUT | `/api/mcp/:id` | Body must include `channelId`; verified against entity |
| DELETE | `/api/mcp/:id` | Query param `channelId` required; verified against entity |

### Error Responses

```json
// Entity not found OR channel mismatch (same response to prevent enumeration)
{ "error": "not_found", "message": "Resource not found" }
// Status: 404
```

---

## Channel Config — New Fields

### `GET /api/channels/:id` — Response additions

```json
{
  "data": {
    "...existing fields...",
    "approvalTimeoutMs": 600000,
    "channelAdmins": ["U12345", "U67890"]
  }
}
```

### `PUT /api/channels/:id` — New updatable fields

```json
{
  "approvalTimeoutMs": 300000,
  "channelAdmins": ["U12345", "U67890"]
}
```

**Validation**:
- `approvalTimeoutMs`: integer, min 60000, max 3600000
- `channelAdmins`: array of non-empty strings

---

## Slash Commands — Permission Tiers

### New behavior

| Command | Tier | Who can execute |
|---------|------|----------------|
| `/pclaw help` | read-only | Any channel member |
| `/pclaw status` | read-only | Any channel member |
| `/pclaw skills` | read-only | Any channel member |
| `/pclaw memory` | read-only | Any channel member |
| `/pclaw config` | read-only | Any channel member |
| `/pclaw model <name>` | admin | Channel admins only |
| `/pclaw compact` | admin | Channel admins only |
| `/pclaw admin add <userId>` | admin | Channel admins only (new command) |
| `/pclaw admin remove <userId>` | admin | Channel admins only (new command) |
| `/pclaw admin list` | read-only | Any channel member |

### Error response for unauthorized commands

```text
Sorry, only channel admins can use `/pclaw model`. Current admins: @user1, @user2.
Use `/pclaw admin list` to see who has admin access.
```

---

## Approval Gateway — Behavioral Changes

### Plan approval scope

**Before**: `planApproved = true` → all tools auto-approved forever.

**After**: Plan approval records:
- Specific tool names from the plan
- Timestamp of approval
- Channel-configured timeout (default 10 min)

Tools not in the plan → require individual approval.
Approved tools after timeout → require re-approval.

### Safe tool list

**Before**: `aws_cli`, `github_cli`, `curl_fetch` hardcoded as safe → bypass gateway.

**After**: These tools removed from safe list. Default policy: `ask`. Channel admins can set `auto` policy via `/api/approvals` endpoint.
