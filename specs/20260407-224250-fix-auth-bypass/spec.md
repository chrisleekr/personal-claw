# Feature Specification: Fix Auth Bypass in WebSocket, Approval Gateway, and Slash Commands

**Feature Branch**: `20260407-224250-fix-auth-bypass`
**Created**: 2026-04-07
**Status**: Draft
**Input**: User description: "Fix WebSocket, approval gateway, and CLI tools bypass authentication/authorization"

## Clarifications

### Session 2026-04-07

- Q: How should scoped plan approval work after a plan is approved? → A: Track approved tool names + add a session timeout (e.g., 10 minutes). Auto-approve only tools listed in the approved plan within the timeout window; require re-approval for unlisted tools or after timeout expires.
- Q: How should CLI tools (aws_cli, github_cli, curl_fetch) currently marked as "safe" be handled? → A: Remove from hardcoded safe list; default to `ask` policy via the approval gateway. Channel admins can explicitly set `auto` policy per tool to restore autonomous execution.
- Q: How should channel ownership scoping be enforced on CRUD endpoints? → A: Add channel ownership verification to all CRUD endpoints (memories, approvals, schedules, skills, MCP) — verify the entity's channel belongs to the authenticated user before any mutation. Match the pattern `conversations.ts` already uses. No sharing model needed.
- Q: How should the plan approval timeout be configured? → A: Per-channel configurable with a 10-minute global default. Each channel can override the timeout via its approval settings.
- Q: Is CSRF protection needed for state-mutating API requests? → A: Not applicable — API uses Bearer token auth (not cookies), so CSRF attacks cannot exploit automatic cookie inclusion. Document as explicitly out of scope with a guardrail: if cookie-based auth is ever introduced, CSRF protection must be revisited.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Authenticated WebSocket Connections (Priority: P1)

As a dashboard user, I expect that only authenticated users can connect to the real-time config updates feed, so that unauthorized parties cannot observe channel activity or configuration changes.

**Why this priority**: The WebSocket endpoint (`/ws/config-updates`) currently accepts connections from any client with zero authentication. This is the most exploitable gap — an attacker only needs the server address to passively observe all channel config changes in real time.

**Independent Test**: Can be fully tested by attempting a WebSocket connection without valid credentials and verifying it is rejected, then connecting with valid credentials and verifying config updates are received.

**Acceptance Scenarios**:

1. **Given** a user without a valid session or token, **When** they attempt to connect to the WebSocket endpoint, **Then** the connection upgrade is rejected with an appropriate error.
2. **Given** a user with a valid authenticated session, **When** they connect to the WebSocket endpoint, **Then** the connection is accepted and they receive config update messages.
3. **Given** an authenticated WebSocket connection, **When** a config change occurs for a channel the user has access to, **Then** the user receives the update notification.
4. **Given** an authenticated WebSocket connection, **When** the user's session expires or is revoked, **Then** the WebSocket connection is terminated gracefully.

---

### User Story 2 - Scoped Plan Approval (Priority: P1)

As a user who approves an agent's execution plan, I expect that the approval applies only to the specific tools listed in the plan and only for a limited time window, so that the agent cannot exploit a one-time approval to execute arbitrary tools indefinitely.

**Why this priority**: Currently, once a plan is approved, `planApproved` is set to `true` permanently for the session. This means ALL subsequent tool calls — even tools not mentioned in the plan — bypass the approval gateway. This is a direct safety bypass that undermines the entire approval system.

**Independent Test**: Can be fully tested by approving a plan that lists specific tools, then having the agent attempt an unlisted tool (should require re-approval), and waiting past the timeout window then attempting an approved tool (should require re-approval).

**Acceptance Scenarios**:

1. **Given** a user approves a plan listing tools X and Y, **When** the agent calls tool X within the timeout window, **Then** the tool auto-executes without additional approval.
2. **Given** a user approves a plan listing tools X and Y, **When** the agent calls tool Z (not in the plan), **Then** the system requires a new approval request regardless of plan approval status.
3. **Given** a user approves a plan, **When** the timeout window expires (e.g., 10 minutes), **Then** all subsequent tool calls require re-approval even if they were in the original plan.
4. **Given** a user approves a plan, **When** the agent requests re-approval after timeout, **Then** the user can approve a new or revised plan with a fresh timeout window.

---

### User Story 3 - Approval Gateway User Identity Verification (Priority: P1)

As a channel administrator who has configured allowlist-based approval policies, I expect that the approval gateway verifies the identity of the user requesting tool execution, so that allowlist policies cannot be bypassed by spoofing a user ID.

**Why this priority**: The approval gateway is the critical safety mechanism controlling tool execution. If user identity can be spoofed, an unauthorized user could bypass `allowlist` policies and trigger tool execution without proper approval — a direct security and safety concern.

**Independent Test**: Can be fully tested by configuring an allowlist policy, then verifying that only the specified users can auto-approve tool executions, and that requests with spoofed or mismatched user IDs are rejected or escalated to manual approval.

**Acceptance Scenarios**:

1. **Given** an allowlist policy for a tool, **When** a user on the allowlist triggers that tool, **Then** the tool auto-executes after verifying the user's identity against the platform source.
2. **Given** an allowlist policy for a tool, **When** a user NOT on the allowlist triggers that tool, **Then** the tool execution is blocked or escalated to manual approval.
3. **Given** an allowlist policy, **When** a request arrives with a user ID that cannot be verified against the originating platform, **Then** the gateway treats the request as unauthenticated and falls back to the `ask` policy (manual approval).

---

### User Story 4 - CLI Tools Require Approval Gateway (Priority: P1)

As a channel administrator, I expect that all tool executions — including CLI tools like AWS CLI, GitHub CLI, and curl — go through the approval gateway, so that destructive tools cannot silently bypass safety controls.

**Why this priority**: CLI tools (`aws_cli`, `github_cli`, `curl_fetch`) are currently hardcoded as "safe" and bypass the approval gateway entirely. These tools can delete AWS resources, push to repositories, and make arbitrary HTTP requests. This is a critical safety bypass.

**Independent Test**: Can be fully tested by invoking a CLI tool (e.g., `aws_cli`) and verifying it goes through the approval gateway policy check instead of auto-executing. Then configure `auto` policy for that tool and verify it auto-executes.

**Acceptance Scenarios**:

1. **Given** a channel with no explicit policy for `aws_cli`, **When** the agent attempts to call `aws_cli`, **Then** the system applies the default `ask` policy and requests user approval.
2. **Given** a channel where the admin has set `auto` policy for `aws_cli`, **When** the agent calls `aws_cli`, **Then** the tool auto-executes without approval prompts.
3. **Given** a channel where the admin has set `deny` policy for `curl_fetch`, **When** the agent calls `curl_fetch`, **Then** the tool is blocked entirely.
4. **Given** a fresh channel with no policies configured, **When** the agent calls any previously "safe" CLI tool, **Then** the default `ask` policy applies (no hardcoded bypass).

---

### User Story 5 - Slash Command Permission Controls (Priority: P2)

As a channel owner or administrator, I expect that sensitive slash commands (like model switching, memory compaction) are restricted to authorized users, so that any channel member cannot modify the agent's behavior.

**Why this priority**: Currently any user in a Slack channel can execute `/pclaw model` or `/pclaw compact`, changing how the agent behaves for all users in that channel. While less immediately exploitable than the WebSocket or gateway issues, this is a privilege escalation risk.

**Independent Test**: Can be fully tested by having a non-admin user attempt a restricted command and verifying it is denied, then having an admin user execute the same command successfully.

**Acceptance Scenarios**:

1. **Given** a channel with an owner/admin configured, **When** a non-admin user executes a configuration-changing command (e.g., `/pclaw model`), **Then** the system denies the command and informs the user they lack permission.
2. **Given** a channel with an owner/admin configured, **When** an admin user executes a configuration-changing command, **Then** the command executes normally.
3. **Given** a channel with no explicit admin configured, **When** any user executes a command, **Then** the system falls back to a reasonable default (e.g., the channel creator is admin, or all users can execute read-only commands but not state-changing ones).
4. **Given** a user executes a read-only command (e.g., `/pclaw status`, `/pclaw help`), **When** they are any channel member, **Then** the command executes regardless of permission level.

---

### User Story 6 - Channel Scoping on CRUD Endpoints (Priority: P1)

As an authenticated user, I expect that I can only create, read, update, or delete entities (memories, approval policies, schedules, skills, MCP configs) belonging to channels declared in my request, so that no request can tamper with another channel's data.

**Why this priority**: Currently all CRUD endpoints accept bare entity IDs without verifying that the entity's channel belongs to the requesting user. Any authenticated user with a valid API token can modify or delete any channel's data — this is a direct authorization bypass.

**Independent Test**: Can be fully tested by creating an entity on channel A, then attempting to read/update/delete it using a request scoped to channel B — the request should be rejected.

**Acceptance Scenarios**:

1. **Given** an authenticated user who owns channel A, **When** they attempt to update a memory belonging to channel A, **Then** the operation succeeds.
2. **Given** an authenticated user who owns channel A, **When** they attempt to delete a skill belonging to channel B (which they do not own), **Then** the operation is rejected with a forbidden error.
3. **Given** an authenticated user, **When** they attempt to list entities, **Then** they only see entities belonging to channels they own.
4. **Given** an authenticated user, **When** they attempt to create an entity for a channel they do not own, **Then** the operation is rejected.

---

### User Story 7 - WebSocket Channel-Scoped Updates (Priority: P2)

As an authenticated dashboard user, I expect to only receive config update notifications for channels I have access to, so that I cannot observe changes to channels belonging to other users or teams.

**Why this priority**: Even after adding authentication to WebSocket, if all updates are broadcast to all authenticated users, there is still an information disclosure risk. Updates should be scoped to channels the user is authorized to view.

**Independent Test**: Can be fully tested by connecting two authenticated users with access to different channels, triggering a config change, and verifying each user only receives updates for their authorized channels.

**Acceptance Scenarios**:

1. **Given** an authenticated user connected via WebSocket, **When** a config change occurs for a channel they have access to, **Then** they receive the update.
2. **Given** an authenticated user connected via WebSocket, **When** a config change occurs for a channel they do NOT have access to, **Then** they do NOT receive the update.

---

### Edge Cases

- What happens when a WebSocket token expires mid-connection? The connection should be terminated with a close frame indicating authentication expiry.
- What happens when a channel admin is removed while a WebSocket client is subscribed to that channel? The subscription remains active until the next reconnect; admin removal does not affect WebSocket subscriptions (subscriptions are based on channel existence, not admin status).
- What happens when an approval request is made with no user ID at all? The gateway should default to the most restrictive policy (`ask`/manual approval).
- What happens when Slack user context cannot be resolved for a slash command? The command should be rejected with an informative error message.
- What happens when a user attempts to delete an entity using a valid ID but belonging to another channel? The system returns a forbidden error and does not reveal whether the entity exists (preventing enumeration).
- What happens when a previously "safe" CLI tool is called in a channel that has no explicit policy? The default `ask` policy applies — no silent execution.
- What happens when a channel has no admin/owner configured and a state-changing command is issued? The system should use a defined fallback (e.g., first user or creator becomes admin, or deny state changes until an admin is set).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST authenticate WebSocket connections before accepting the upgrade. The backend MUST provide a single-use, 60-second-TTL WebSocket ticket endpoint that the dashboard obtains via the authenticated proxy; the ticket is passed as a query parameter during the WebSocket handshake. The server-side `API_SECRET` MUST NOT be exposed to the browser client.
- **FR-002**: System MUST reject WebSocket connection attempts that lack valid authentication with an appropriate error response.
- **FR-003**: System MUST scope WebSocket config-update broadcasts to only the channels the authenticated user is authorized to access.
- **FR-004**: System MUST terminate WebSocket connections when the associated authentication credential expires or is revoked.
- **FR-005**: Approval gateway MUST record the specific tool names listed in an approved plan and only auto-approve calls to those exact tools. Tool names MUST be declared explicitly in the plan confirmation schema (via a dedicated `toolNames` field), not parsed from free-text step descriptions.
- **FR-006**: Approval gateway MUST enforce a per-channel configurable session timeout (global default: 10 minutes) on plan approval; after timeout, all tool calls require re-approval regardless of plan status. Each channel can override the timeout via its approval settings.
- **FR-007**: Approval gateway MUST require a new approval request when the agent attempts to call a tool not listed in the approved plan.
- **FR-008**: System MUST remove all hardcoded "safe" tool classifications that bypass the approval gateway (specifically `aws_cli`, `github_cli`, `curl_fetch`).
- **FR-009**: All tool executions MUST go through the approval gateway policy evaluation. The only permitted bypass is the pipeline-built `safeToolNames` set (per Constitution Principle VI), which covers genuinely non-destructive tools (e.g., memory read, identity get). FR-008 is a specific instance of this rule for CLI tools.
- **FR-010**: Channel administrators MUST be able to set per-tool policies (including `auto`) to explicitly grant autonomous execution for specific tools.
- **FR-011**: Approval gateway MUST verify user identity against the originating platform's verified context (e.g., Slack request signature, verified user ID from the platform event) before evaluating allowlist policies.
- **FR-012**: Approval gateway MUST fall back to manual approval (`ask` policy) when user identity cannot be verified.
- **FR-013**: All state-mutating CRUD endpoints (memories, approvals, schedules, skills, MCP configs) MUST verify that the target entity's channel belongs to the authenticated user before executing the operation.
- **FR-014**: All list/read CRUD endpoints MUST scope results to only entities belonging to the channel declared in the request. (Note: with the current shared `API_SECRET` auth model, "ownership" means the request explicitly declares which channel it operates on, and the server verifies the entity belongs to that channel.)
- **FR-015**: System MUST return a forbidden error when a user attempts to access or modify entities belonging to a channel they do not own.
- **FR-016**: System MUST classify slash commands into permission tiers — read-only commands (status, help, skills, memory, config) and state-changing commands (model, compact).
- **FR-017**: System MUST enforce permission checks on state-changing slash commands, allowing execution only by users with an admin/owner role for the channel.
- **FR-018**: System MUST allow read-only slash commands to be executed by any channel member without additional permission checks.
- **FR-019**: System MUST provide a mechanism to designate channel administrators (e.g., channel creator auto-assigned as admin, or explicit admin management).
- **FR-020**: System MUST log all authentication failures (WebSocket rejections, gateway identity verification failures, slash command permission denials) for audit purposes.

### Key Entities

- **Channel Role**: Represents a user's permission level within a channel (e.g., admin, member). Associates a user identity with a channel and defines what actions they can perform.
- **WebSocket Session**: Represents an authenticated real-time connection, associating a user identity with a set of authorized channel IDs for scoped message delivery.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of unauthenticated WebSocket connection attempts are rejected — zero config updates are delivered to unauthenticated clients.
- **SC-002**: Authenticated WebSocket users receive config updates only for channels they are authorized to access, with zero cross-channel information leakage.
- **SC-003**: Plan approval auto-executes only the specific tools listed in the approved plan — zero unlisted tools execute without explicit re-approval.
- **SC-004**: Plan approval expires after the configured timeout — zero tool calls auto-execute after the timeout window.
- **SC-005**: Zero tool executions bypass the approval gateway via hardcoded safe-list exceptions — all tools evaluated by policy.
- **SC-006**: Allowlist-based approval policies enforce identity verification for every request — zero tool executions occur with unverified user identity in allowlist mode.
- **SC-007**: Zero cross-channel entity access — authenticated users can only read, create, update, or delete entities belonging to channels they own.
- **SC-008**: State-changing slash commands are executed only by authorized users (admin/owner) — non-admin attempts are denied 100% of the time.
- **SC-009**: Read-only slash commands remain accessible to all channel members with no change in availability.
- **SC-010**: All authentication and authorization failures are logged with sufficient detail for post-incident audit.

## Assumptions

- The existing NextAuth JWT session mechanism and API Bearer token authentication are sound and will be extended (not replaced) to cover WebSocket and slash command authorization.
- Slack's request signing (via Bolt framework) provides a trusted source of user identity for messages, slash commands, and interactive actions originating from Slack.
- Channel access control will initially be simple (admin/member roles), not a full RBAC system. Future iterations may add more granular roles.
- The approval gateway's user ID currently comes from the Slack event context, which is already verified by Slack's request signature — the fix is to ensure this verified identity is explicitly passed through and trusted, rather than accepting arbitrary user IDs.
- Rate limiting on API endpoints, while identified as a gap, is out of scope for this feature and will be addressed separately.
- CSRF protection is not applicable because the API uses Bearer token authentication (not cookies). Bearer tokens are not automatically sent by browsers, so CSRF attacks cannot exploit them. If cookie-based auth is ever introduced, CSRF protection must be revisited.
- The focus is on the five identified bypass vectors (WebSocket auth, blanket plan approval, CLI tools safe list, channel ownership scoping, approval gateway identity); broader auth improvements (per-user API keys, full RBAC) are out of scope.
