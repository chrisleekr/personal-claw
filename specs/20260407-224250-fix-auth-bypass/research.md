# Research: Fix Auth Bypass

## R1: WebSocket Authentication Strategy

**Decision**: Use a short-lived WebSocket ticket obtained via the authenticated API proxy. The backend exposes `GET /api/ws-ticket` that returns a single-use, time-limited token (UUID, 60-second TTL, stored in-memory). The frontend obtains this ticket through the existing Next.js proxy (which adds the Bearer token server-side), then passes it as a query parameter: `ws://host/ws/config-updates?ticket=<ticket>`. The Bun fetch handler validates the ticket before calling `server.upgrade()`.

**Rationale**: The `API_SECRET` is a server-side credential and MUST NOT be exposed to browser clients (Constitution VI: "Zero hardcoded secrets"). The existing frontend proxy pattern already handles auth — the ticket approach extends it to WebSocket. Single-use + 60-second TTL prevents ticket replay attacks.

**Alternatives considered**:
- *Pass API_SECRET as query param from frontend*: **REJECTED — security violation**. Would expose the server-side secret to every browser client. The API_SECRET is shared across all operations; leaking it gives full API access.
- *Cookie-based session*: Would require introducing cookie auth on the API, adding CSRF concerns. Rejected — adds complexity and contradicts current Bearer-only auth model.
- *First-message auth*: Accept the upgrade, then require a token in the first WS message. Rejected — the connection is already open before auth, creating a window for information leakage.
- *Subprotocol header*: Pass token via `Sec-WebSocket-Protocol`. Rejected — misuse of the subprotocol header; breaks protocol semantics.

## R2: Channel-Scoped WebSocket Broadcasts

**Decision**: Store ticket metadata in the WebSocket `data` field during upgrade. Use a `Map<string, Set<ServerWebSocket>>` keyed by channel ID instead of a flat `Set<ServerWebSocket>`. When the client connects, it sends a subscription message with channel IDs; the server adds the connection to the appropriate channel broadcast sets.

**Rationale**: Bun's `server.upgrade(req, { data: { ... } })` passes arbitrary data to the WebSocket instance. The current flat `Set<ServerWebSocket>` broadcasts to everyone. A channel-keyed map enables targeted broadcasts.

**Alternatives considered**:
- *Server-side channel lookup on connect*: Query which channels the user owns, auto-subscribe. Rejected — adds DB query on every WS connect and doesn't handle dynamic channel creation.
- *Client-side filtering only*: Keep broadcast-all, filter in frontend. Rejected — information disclosure; authenticated clients can still observe all channel data.

## R3: Scoped Plan Approval Implementation

**Decision**: Replace the boolean `planApproved` flag with a `PlanApprovalState` object containing: `approvedToolNames: Set<string>`, `approvedAt: number` (timestamp), `timeoutMs: number` (from channel config, default 600000ms / 10 minutes). The `checkApproval()` method checks: (1) tool name is in `approvedToolNames`, AND (2) `Date.now() - approvedAt < timeoutMs`. Tool names are provided explicitly via a new `toolNames` field in the `confirm_plan` input schema, not parsed from free-text step descriptions.

**Rationale**: The current boolean flag grants blanket access forever. Tracking specific tool names and adding a timeout addresses both scope and duration. Requiring explicit `toolNames` in the schema (rather than parsing from step text) ensures reliable extraction — the LLM declares exactly which tools it intends to use.

**Alternatives considered**:
- *Parse tool names from step text via regex*: Match against known tool registry. Rejected — fragile; depends on LLM wording; misses tools or matches false positives.
- *Invocation count per tool*: Track how many times each tool is called and cap it. Rejected — hard to predict correct counts; adds UX friction without proportional security benefit.
- *Full plan replay verification*: Verify each tool call matches the exact sequence in the plan. Rejected — too rigid; agents often adjust tool call order based on intermediate results.

## R4: CLI Tools Safe List Removal

**Decision**: Remove `getSafeToolNames()` return values for `aws_cli`, `github_cli`, `curl_fetch` from `CLIToolProvider`. These tools will default to the approval gateway's `ask` policy. Channel admins can set `auto` policy per tool via the existing approval policies CRUD API. The `safeToolNames` mechanism is retained for genuinely non-destructive tools (memory, identity) per Constitution VI.

**Rationale**: Constitution VI explicitly states "Safe tool names come from channel approval policies in the DB and the `safeToolNames` set built in the pipeline — never hardcoded." The current `CLIToolProvider.getSafeToolNames()` returning destructive CLI tools is a violation. The fix removes only the CLI tools; memory/identity tools remain safe per the constitution's pipeline-built set.

**Alternatives considered**:
- *Remove all `getSafeToolNames()` methods*: Make every tool go through approval. Rejected — memory and identity tools are genuinely safe (read/write to own channel data only); requiring approval for `memory_search` would break usability.
- *Keep safe list but add a warning*: Log when safe tools are used. Rejected — doesn't fix the security bypass.

## R5: Channel Ownership Verification Pattern

**Decision**: Replicate the `conversations.ts` pattern: every mutation endpoint receives `channelId` as a required parameter (path param or body field), fetches the entity by ID, then verifies `entity.channelId === requestedChannelId`. Return `NotFoundError` on mismatch (prevents entity enumeration).

**Rationale**: The `conversations` route already implements this correctly. The pattern is proven, simple, and doesn't require schema changes. Since the API uses a shared `API_SECRET` (not per-user tokens), "channel scoping" means the request explicitly declares which channel it's operating on, and the server verifies the entity belongs to that channel.

**Alternatives considered**:
- *Add `ownerId` column to channels table*: Would enable true per-user ownership. Rejected for this PR — requires new migration, frontend changes, and doesn't solve the immediate bypass (all requests use the same API_SECRET).
- *Middleware-level channel extraction*: Auto-extract channelId from all requests in middleware. Rejected — routes have different parameter patterns (path param vs body vs query); per-route handling is clearer.

## R6: Slash Command Permission Tiers

**Decision**: Classify commands into `read-only` (help, status, skills, memory, config) and `admin` (model, compact). Store per-channel admin user list in a new `channel_admins` field (text array) on the channels table. The first user to interact with a channel via slash command is auto-assigned as admin. Admins can add/remove other admins via a new `/pclaw admin` command.

**Rationale**: Simple two-tier model (member vs admin) is sufficient for the current single-platform (Slack) deployment. Auto-assigning the first user avoids a bootstrap problem where no one can become admin. The admin list on the channels table avoids a new join table.

**Alternatives considered**:
- *Slack workspace admin = channel admin*: Use Slack's admin API to check if user is workspace admin. Rejected — requires additional Slack API scopes and doesn't work for non-admin channel creators.
- *Full RBAC with roles table*: Overkill for current needs; explicitly deferred in spec assumptions.

## R7: Approval Timeout Channel Configuration

**Decision**: Add an `approval_timeout_ms` column (integer, default 600000) to the `channels` table. Expose via the existing channel config API. The `ApprovalGateway` reads this value when constructing `PlanApprovalState`.

**Rationale**: Per-channel configuration aligns with the existing pattern where all channel behavior (model, autonomy level, guardrails) is configured per-channel. A simple integer column is the lightest-weight approach.

**Alternatives considered**:
- *Separate approval_config JSON column*: Store timeout alongside other approval settings. Rejected — YAGNI; a single column is simpler and the JSON approach can be adopted later if more settings emerge.
- *Environment variable*: Global timeout via env var. Rejected — doesn't allow per-channel customization as specified.

## R8: WebSocket Session Expiry (FR-004)

**Decision**: Implement a periodic heartbeat check that validates WebSocket ticket freshness. Since tickets are single-use and short-lived (60s), the session itself has no inherent expiry — but the heartbeat mechanism (already at 30-second intervals) will be extended to close connections that have been open longer than a configurable maximum session duration (default: 24 hours). For immediate revocation needs (e.g., API_SECRET rotation), a `/ws/disconnect-all` internal endpoint can force-close all connections.

**Rationale**: The current WS implementation already has a 30-second heartbeat ping. Extending this to check session age is low-effort. The 24-hour max session covers the credential rotation case without requiring complex session invalidation infrastructure. For the current shared-secret model, individual session revocation isn't needed — if the secret changes, all connections should terminate.

**Alternatives considered**:
- *Token refresh via WS message*: Client periodically sends a fresh ticket. Rejected — adds round-trip complexity; tickets are obtained via HTTP proxy which doesn't map well to WS.
- *Redis-backed session store*: Track active sessions with TTL. Rejected — YAGNI for single-tenant deployment; adds infrastructure dependency.
