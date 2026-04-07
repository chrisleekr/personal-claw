# Tasks: Fix Auth Bypass in WebSocket, Approval Gateway, and CLI Tools

**Input**: Design documents from `/specs/20260407-224250-fix-auth-bypass/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api-changes.md

**Tests**: Not explicitly requested in the spec. Test tasks are omitted. Run `bun run check` after each phase.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

**Analysis fixes applied**: C1 (FR-004 coverage), C2 (WS ticket auth instead of API_SECRET leak), I1 (FR-009 safe tool note), I2 (plan comment), I3 (ownership terminology), U1 (edge case), U2 (tool name extraction), I4 (task ordering for approval-gateway.ts).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Database migration and shared type definitions needed by all user stories

- [x] T001 Add `approval_timeout_ms` (integer, default 600000) and `channel_admins` (text[], default []) columns to channels schema in `packages/db/src/schema/channels.ts`
- [x] T002 Generate and apply Drizzle migration for the new channels columns via `bun run db:generate && bun run db:migrate` in `packages/db/`
- [x] T003 [P] Add `PlanApprovalState` type (approvedToolNames, approvedAt, timeoutMs) to `packages/shared/src/types.ts`
- [x] T004 [P] Add command permission tier constants (READ_ONLY_COMMANDS, ADMIN_COMMANDS) to `packages/shared/src/constants.ts`
- [x] T005 [P] Add Zod validation schemas for `approvalTimeoutMs` (min 60000, max 3600000) and `channelAdmins` (array of non-empty strings) to `packages/shared/src/schemas.ts`

**Checkpoint**: Schema migrated, shared types and constants available for all user stories.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: No additional foundational work needed — existing auth middleware, Hono routing, and LogTape logging are already in place. All user stories can begin after Phase 1.

**Checkpoint**: Foundation ready — user story implementation can begin.

---

## Phase 3: User Story 1 - Authenticated WebSocket Connections (Priority: P1) 🎯 MVP

**Goal**: Reject unauthenticated WebSocket connections using a short-lived ticket mechanism. `API_SECRET` MUST NOT be exposed to the browser.

**Independent Test**: Attempt WS connection without ticket → rejected with 401. Obtain ticket via authenticated proxy, connect with ticket → accepted. Reuse same ticket → rejected (single-use).

### Implementation for User Story 1

- [x] T006 [US1] Create `apps/api/src/routes/ws-ticket.ts` — new Hono route `GET /api/ws-ticket` that generates a UUID ticket, stores it in an in-memory `Map<string, { createdAt: number, used: boolean }>` with 60-second TTL, and returns `{ data: { ticket, expiresIn: 60 } }`. Add periodic cleanup (every 60s) to remove expired tickets. Requires Bearer auth (already covered by auth middleware on `/api/*`).
- [x] T007 [US1] Register the ws-ticket route in `apps/api/src/index.ts` under the `/api` prefix alongside existing routes
- [x] T008 [US1] Update the WebSocket upgrade path in `apps/api/src/index.ts` — extract `ticket` query parameter from the request URL, look up in the ticket store, validate not expired and not used, mark as used, reject with 401 Response if invalid, pass `{ data: { ticketId } }` on successful upgrade
- [x] T009 [US1] Add LogTape logging for WebSocket auth rejections in `apps/api/src/index.ts` — log rejected connection attempts with path and reason using category `['personalclaw', 'ws', 'auth']`
- [x] T010 [US1] Implement WS session max duration check in `apps/api/src/config/hot-reload.ts` — store `connectionOpenedAt` in the WebSocket data field during upgrade, and on each heartbeat ping (every 30s) close connections exceeding 24 hours with close code 4001 (FR-004)
- [x] T011 [US1] Create `apps/web/src/app/api/proxy/ws-ticket/route.ts` — N/A: Existing catch-all proxy at `apps/web/src/app/api/proxy/[...path]/route.ts` already handles `/api/proxy/api/ws-ticket` → backend `/api/ws-ticket`. No dedicated route file needed.
- [x] T012 [US1] Update the frontend WebSocket hook in `apps/web/src/hooks/use-config-updates.ts` — first obtain a ticket via `fetch('/api/proxy/api/ws-ticket')`, then connect with `ws://${host}/ws/config-updates?ticket=${ticket}`. On close code 4001 (session expired), auto-reconnect with a fresh ticket.

**Checkpoint**: Unauthenticated WS connections are rejected. API_SECRET stays server-side. Sessions expire after 24 hours.

---

## Phase 4: User Story 4 - CLI Tools Require Approval Gateway (Priority: P1)

**Goal**: Remove `aws_cli`, `github_cli`, `curl_fetch` from the hardcoded safe list so they go through the approval gateway.

**Independent Test**: Call `aws_cli` without a channel policy → approval prompt appears. Set `auto` policy for `aws_cli` → auto-executes.

**Note**: US4 is moved before US2/US3 because it's the simplest change to `approval-gateway.ts`. US2 and US3 build on top. Recommended implementation order for `approval-gateway.ts`: US4 → US2 → US3 (sequential, not parallel).

### Implementation for User Story 4

- [x] T013 [US4] Remove `aws_cli`, `github_cli`, `curl_fetch` from the `getSafeToolNames()` return array in `CLIToolProvider` in `apps/api/src/agent/tool-providers.ts` — return an empty array `[]`
- [x] T014 [US4] Add LogTape logging in `apps/api/src/agent/approval-gateway.ts` when a tool that has no policy and is not in `safeToolNames` is routed through the default approval path, using category `['personalclaw', 'agent', 'approval']`

**Checkpoint**: CLI tools go through the approval gateway. The `safeToolNames` check remains for genuinely non-destructive tools (memory, identity) per Constitution VI. Channel admins can set `auto` policy per tool via the existing approvals API (FR-010 — already implemented).

---

## Phase 5: User Story 2 - Scoped Plan Approval (Priority: P1)

**Goal**: Plan approval only auto-approves the specific tools listed in the plan, with a configurable per-channel timeout.

**Independent Test**: Approve a plan listing tools X and Y. Call tool X → auto-approved. Call tool Z (unlisted) → requires approval. Wait past timeout → tool X requires re-approval.

**Note**: Depends on US4 being complete (both modify `approval-gateway.ts`).

### Implementation for User Story 2

- [x] T015 [US2] Replace boolean `planApproved` field with `planApprovalState: PlanApprovalState | null` in the `ApprovalGateway` class in `apps/api/src/agent/approval-gateway.ts`
- [x] T016 [US2] Add a `toolNames` field (array of strings) to the `confirm_plan` input schema in `apps/api/src/agent/approval-gateway.ts` alongside the existing `summary` and `steps` fields — the LLM must explicitly declare which tools it intends to use
- [x] T017 [US2] Update `getConfirmPlanTool()` in `apps/api/src/agent/approval-gateway.ts` to read `toolNames` from the input, read `approval_timeout_ms` from the channel config, and construct a `PlanApprovalState` object with `approvedToolNames: new Set(toolNames)`, `approvedAt: Date.now()`, and `timeoutMs`
- [x] T018 [US2] Update `checkApproval()` in `apps/api/src/agent/approval-gateway.ts` — replace the `if (this.planApproved)` block (currently at ~line 230) with: check `planApprovalState` is not null, check `Date.now() - approvedAt < timeoutMs`, check `approvedToolNames.has(toolName)`. If any check fails, fall through to the next approval mechanism.
- [x] T019 [US2] Add LogTape logging for plan approval timeout and out-of-scope tool events in `apps/api/src/agent/approval-gateway.ts` using category `['personalclaw', 'agent', 'approval']`
- [x] T020 [US2] Expose `approvalTimeoutMs` in the channel update route in `apps/api/src/routes/channels.ts` — already handled: updateChannelSchema includes approvalTimeoutMs, channel.service.ts spreads all validated fields to the DB update.

**Checkpoint**: Plan approval is scoped to specific tools and expires after timeout. Unlisted tools require separate approval.

---

## Phase 6: User Story 3 - Approval Gateway User Identity Verification (Priority: P1)

**Goal**: Verify that the user ID in the approval gateway comes from the platform's verified context, not arbitrary input.

**Independent Test**: Configure an allowlist policy. User on allowlist triggers tool → auto-executes. Attempt with unverifiable user ID → falls back to `ask` policy.

**Note**: Depends on US4 and US2 being complete (all modify `approval-gateway.ts`).

### Implementation for User Story 3

- [ ] T021 [US3] Add a `verifiedUserId` flag to the `ApprovalGateway` constructor in `apps/api/src/agent/approval-gateway.ts` — the flag indicates whether the userId was extracted from a verified platform context (Slack request signature) vs. an unverified source
- [ ] T022 [US3] Update `checkApproval()` allowlist evaluation in `apps/api/src/agent/approval-gateway.ts` — when policy is `allowlist`, check `verifiedUserId` is true before comparing against `allowedUsers`. If `verifiedUserId` is false, fall through to `ask` policy instead.
- [ ] T023 [US3] Update the Slack event handler in `apps/api/src/platforms/slack/events.ts` to pass `verifiedUserId: true` when constructing the `ApprovalGateway` (Slack Bolt verifies request signatures before events reach handlers)
- [ ] T024 [US3] Add LogTape logging for identity verification failures in `apps/api/src/agent/approval-gateway.ts` — log when allowlist check is skipped due to unverified user identity

**Checkpoint**: Allowlist policies only auto-approve when user identity is platform-verified. Unverified identities fall back to manual approval.

---

## Phase 7: User Story 5 - Slash Command Permission Controls (Priority: P2)

**Goal**: Restrict state-changing slash commands (`model`, `compact`) to channel admins; read-only commands remain open to all members.

**Independent Test**: Non-admin runs `/pclaw model gpt-4` → denied with message. Admin runs same → succeeds. Any user runs `/pclaw status` → succeeds.

### Implementation for User Story 5

- [ ] T025 [US5] Add a `checkAdmin` helper function in `apps/api/src/platforms/slack/slash-commands.ts` that queries the channel's `channel_admins` array and checks if the requesting Slack user ID is included. If the array is empty (no admins set), auto-assign the requesting user as the first admin.
- [ ] T026 [US5] Add permission tier checking to the slash command dispatcher in `apps/api/src/platforms/slack/slash-commands.ts` — before executing a command, check if it's in `ADMIN_COMMANDS` (from `packages/shared/src/constants.ts`). If so, call `checkAdmin`. If the user is not an admin, respond with a denial message listing current admins.
- [ ] T027 [US5] Implement `/pclaw admin add <userId>`, `/pclaw admin remove <userId>`, and `/pclaw admin list` subcommands in `apps/api/src/platforms/slack/slash-commands.ts` — `add` and `remove` require admin; `list` is read-only. Update the `channel_admins` array in the channels table via `packages/db`.
- [ ] T028 [US5] Register the new `admin` command in the `SLASH_COMMANDS` map in `packages/shared/src/constants.ts` with appropriate help text

**Checkpoint**: State-changing commands restricted to admins. Read-only commands unaffected. First user auto-assigned as admin.

---

## Phase 8: User Story 6 - Channel Ownership Scoping on CRUD Endpoints (Priority: P1)

**Goal**: All CRUD mutation endpoints verify the target entity's `channelId` matches the channel declared in the request, preventing cross-channel data access. (Note: with the current shared `API_SECRET`, "ownership" means channel-scoping — the request declares which channel it operates on, and the server verifies the entity belongs to that channel.)

**Independent Test**: Create a memory on channel A. Attempt to delete it with `channelId=B` → 404. Delete with `channelId=A` → succeeds.

### Implementation for User Story 6

- [ ] T029 [P] [US6] Add channel scoping verification to `apps/api/src/routes/memories.ts` — PATCH and DELETE endpoints must require `channelId` parameter, fetch the entity, verify `entity.channelId === channelId`, throw `NotFoundError` on mismatch (matching the `conversations.ts` pattern)
- [ ] T030 [P] [US6] Add channel scoping verification to `apps/api/src/routes/approvals.ts` — POST verifies the provided `channelId` exists in the channels table, PUT and DELETE require `channelId` and verify against the fetched entity
- [ ] T031 [P] [US6] Add channel scoping verification to `apps/api/src/routes/schedules.ts` — same pattern: require `channelId`, fetch entity, verify match, throw `NotFoundError` on mismatch
- [ ] T032 [P] [US6] Add channel scoping verification to `apps/api/src/routes/skills.ts` — same pattern as above
- [ ] T033 [P] [US6] Add channel scoping verification to `apps/api/src/routes/mcp.ts` — apply to all 5 mutation endpoints (create, update, delete, upsertToolPolicy, deleteToolPolicy). Verify `channelId` on each.
- [ ] T034 [US6] Update corresponding service methods in `apps/api/src/services/` (memory.service.ts, approval.service.ts, schedule.service.ts, skill.service.ts, mcp.service.ts) to accept `channelId` parameter and include it in queries where needed for verification

**Checkpoint**: All CRUD endpoints verify channel scoping. Cross-channel access returns 404.

---

## Phase 9: User Story 7 - WebSocket Channel-Scoped Updates (Priority: P2)

**Goal**: Authenticated WebSocket clients only receive config updates for channels they subscribe to, not all channels.

**Independent Test**: Two authenticated clients subscribe to different channels. Config change on channel A → only client A receives update.

**Note**: Depends on US1 (WebSocket auth must be in place before adding channel subscriptions).

### Implementation for User Story 7

- [ ] T035 [US7] Replace `wsClients: Set<ServerWebSocket>` with `wsChannelClients: Map<string, Set<ServerWebSocket>>` in `apps/api/src/config/hot-reload.ts` — key is channelId, value is set of connections subscribed to that channel
- [ ] T036 [US7] Add a `message` handler to the WebSocket handler in `apps/api/src/config/hot-reload.ts` — parse incoming messages for `{ type: "subscribe", channelIds: string[] }`, validate channel IDs exist, and add the connection to the appropriate channel sets in the map
- [ ] T037 [US7] Update `broadcastToClients()` in `apps/api/src/config/hot-reload.ts` to only send to connections in `wsChannelClients.get(channelId)` instead of broadcasting to all clients
- [ ] T038 [US7] Update `removeClient()` in `apps/api/src/config/hot-reload.ts` to remove the connection from all channel sets in the map
- [ ] T039 [US7] Update the frontend WebSocket hook in `apps/web/src/hooks/use-config-updates.ts` to send a subscribe message with the relevant channel IDs after connection is established

**Checkpoint**: WebSocket broadcasts are channel-scoped. Clients only receive updates for subscribed channels.

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, quality checks, and cross-story validation

- [ ] T040 [P] Add JSDoc comments to all new exported functions and types per constitution Principle IV — `PlanApprovalState`, `checkAdmin`, WS ticket route, channel scoping helpers
- [ ] T041 [P] Update `docs/SAFEGUARDS.md` with the new scoped plan approval flow, CLI tool approval changes, and channel scoping enforcement — include a Mermaid diagram for the updated approval flow per constitution Principle IV
- [ ] T042 Run `bun run check` (typecheck + lint + test) and fix any issues across all modified files
- [ ] T043 Validate all changes against the quickstart.md scenarios — WebSocket ticket auth, scoped approval, CLI tool approval, channel scoping checks, slash command permissions

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 (schema migration must complete)
- **User Stories (Phases 3-9)**: All depend on Phase 1 completion
- **Polish (Phase 10)**: Depends on all user stories being complete

### User Story Dependencies

- **US1 - WebSocket Auth (P1)**: No dependencies on other stories. Start after Phase 1.
- **US4 - CLI Tools Approval (P1)**: No dependencies on other stories. Start after Phase 1.
- **US2 - Scoped Plan Approval (P1)**: **Depends on US4** (both modify `approval-gateway.ts`; US4 is simplest, do first).
- **US3 - Identity Verification (P1)**: **Depends on US4 and US2** (all three modify `checkApproval()` in `approval-gateway.ts`; implement sequentially: US4 → US2 → US3).
- **US5 - Slash Command Perms (P2)**: Depends on Phase 1 (needs `channel_admins` column). No dependencies on other stories.
- **US6 - Channel Scoping (P1)**: No dependencies on other stories. Start after Phase 1. All 5 route files can be updated in parallel (T029-T033).
- **US7 - WS Channel Scoping (P2)**: **Depends on US1** (WebSocket auth must be in place before adding channel subscriptions).
- **FR-010** (per-tool policy management): Already implemented via existing approvals CRUD API — no new task needed.

### Within Each User Story

- Schema/type changes before logic changes
- Core implementation before logging/polish
- Service layer before route layer

### Parallel Opportunities

- **Phase 1**: T003, T004, T005 can run in parallel (different files in `packages/shared/`)
- **After Phase 1**: US1, US4, US5, US6 can all start in parallel (different files)
- **Approval gateway chain**: US4 → US2 → US3 must be sequential (same file: `approval-gateway.ts`)
- **US6**: T029, T030, T031, T032, T033 can all run in parallel (different route files)
- **Phase 10**: T040, T041 can run in parallel

---

## Parallel Example: User Story 6 (Channel Scoping)

```bash
# Launch all route scoping tasks in parallel (different files):
Task T029: "Add channel scoping to apps/api/src/routes/memories.ts"
Task T030: "Add channel scoping to apps/api/src/routes/approvals.ts"
Task T031: "Add channel scoping to apps/api/src/routes/schedules.ts"
Task T032: "Add channel scoping to apps/api/src/routes/skills.ts"
Task T033: "Add channel scoping to apps/api/src/routes/mcp.ts"

# Then sequentially:
Task T034: "Update service methods to accept channelId parameter"
```

---

## Implementation Strategy

### MVP First (User Story 1 + 4 + 6)

1. Complete Phase 1: Setup (migration + types)
2. Complete US1: WebSocket Auth with ticket mechanism (most exploitable gap)
3. Complete US4: CLI Tools Approval (constitution violation fix)
4. Complete US6: Channel Scoping (broadest impact — 5 routes)
5. **STOP and VALIDATE**: Run `bun run check`, verify all 3 fixes work independently
6. Deploy — this addresses the 3 most critical bypasses

### Full Delivery

1. MVP above
2. Add US2: Scoped Plan Approval (approval gateway hardening) — after US4
3. Add US3: Identity Verification (allowlist policy hardening) — after US2
4. Add US5: Slash Command Permissions (privilege escalation fix) — independent
5. Add US7: WS Channel Scoping (information disclosure fix) — after US1
6. Phase 10: Polish, docs, final validation

### Parallel Team Strategy

With multiple developers after Phase 1:
- Developer A: US1 (WebSocket ticket auth) → US7 (WS channel scoping)
- Developer B: US4 (CLI tools) → US2 (scoped approval) → US3 (identity verification) — sequential, same file
- Developer C: US6 (channel scoping — 5 parallel route files)
- Developer D: US5 (slash command perms)

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- All changes must pass `bun run check` before committing
- Commit messages must follow Conventional Commits: `fix(security):` prefix for all tasks
- Constitution Principle III (Channel Isolation) is the primary driver for US6
- Constitution Principle VI (Security by Default) is the primary driver for US4 and US1
- The `conversations.ts` pattern is the reference implementation for US6 channel scoping checks
- US4, US2, US3 MUST be implemented sequentially (all modify `checkApproval()` in `approval-gateway.ts`)
- "Channel scoping" (not "ownership") is the correct terminology given the shared `API_SECRET` auth model
