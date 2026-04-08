# Implementation Plan: Fix Auth Bypass in WebSocket, Approval Gateway, and CLI Tools

**Branch**: `20260407-224250-fix-auth-bypass` | **Date**: 2026-04-07 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/20260407-224250-fix-auth-bypass/spec.md`

## Summary

Fix five authentication/authorization bypass vectors identified in GitHub issue #8:
1. WebSocket `/ws/config-updates` accepts unauthenticated connections and broadcasts all channel updates to all clients
2. Plan approval sets a permanent `planApproved` flag that bypasses all future tool approval checks
3. CLI tools (`aws_cli`, `github_cli`, `curl_fetch`) are hardcoded as "safe" and skip the approval gateway
4. CRUD endpoints (memories, approvals, schedules, skills, MCP) accept bare IDs without channel ownership verification
5. Slash commands lack permission controls — any channel member can execute state-changing commands

## Technical Context

**Language/Version**: TypeScript 5.7+ (strict mode, zero `any`) + Bun 1.3.9
**Primary Dependencies**: Hono (API), Bun ServerWebSocket, Drizzle ORM, LogTape, Zod, `@personalclaw/shared`
**Storage**: PostgreSQL with pgvector (via `packages/db`)
**Testing**: Bun test runner (`bun test`), Hono test client for integration tests
**Target Platform**: Linux server (Docker), Bun runtime
**Project Type**: Web service (monorepo: API backend + Next.js frontend)
**Performance Goals**: WebSocket auth check must not add perceptible latency to connection upgrade
**Constraints**: All changes must be backward-compatible with existing Slack integrations; no breaking changes to channel auto-registration; `API_SECRET` must never be exposed to browser clients
**Scale/Scope**: Single-tenant deployment; channels are the isolation boundary

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Strict TypeScript / Bun | PASS | All changes in TypeScript strict mode; Bun test runner only |
| II. Package Boundary Isolation | PASS | DB access through `packages/db`; shared types in `packages/shared`; `apps/web` communicates via API only |
| III. Channel Isolation | PASS | This feature *enforces* channel isolation — adding scoping checks to routes that currently lack them |
| IV. Documentation Standards | PASS | JSDoc on all new exported functions; Mermaid diagram for approval flow |
| V. Memory Engine Encapsulation | PASS | No direct memory table queries — changes are in route-level scoping checks |
| VI. Security by Default | PASS | Removes hardcoded safe tool list (constitution says "never hardcoded"); enforces approval gateway for all tools; validates credentials on WebSocket; API_SECRET never exposed to browser |
| VII. Structured Observability | PASS | All auth failures logged via LogTape with category hierarchy |

**Gate result: PASS** — No violations. This feature directly enforces constitution principles III and VI.

## Project Structure

### Documentation (this feature)

```text
specs/20260407-224250-fix-auth-bypass/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0: Research findings
├── data-model.md        # Phase 1: Data model changes
├── quickstart.md        # Phase 1: Developer quickstart
├── contracts/           # Phase 1: API contract changes
│   └── api-changes.md
├── checklists/
│   └── requirements.md  # Specification quality checklist
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
apps/api/
├── src/
│   ├── index.ts                          # WebSocket ticket validation before upgrade
│   ├── middleware/
│   │   └── auth.ts                       # Existing Bearer token auth (unchanged)
│   ├── agent/
│   │   ├── approval-gateway.ts           # Scoped plan approval + remove safe tool bypass
│   │   └── tool-providers.ts             # Remove CLI tools from safe list
│   ├── config/
│   │   └── hot-reload.ts                 # Channel-scoped WebSocket broadcasts
│   ├── routes/
│   │   ├── ws-ticket.ts                  # NEW: Short-lived WS ticket endpoint
│   │   ├── memories.ts                   # Add channel scoping checks
│   │   ├── approvals.ts                  # Add channel scoping checks
│   │   ├── schedules.ts                  # Add channel scoping checks
│   │   ├── skills.ts                     # Add channel scoping checks
│   │   └── mcp.ts                        # Add channel scoping checks
│   ├── platforms/slack/
│   │   └── slash-commands.ts             # Add permission tier checks
│   └── __tests__/
│       ├── ws-auth.test.ts               # WebSocket auth tests
│       ├── approval-gateway-scoped.test.ts # Scoped approval tests
│       ├── route-ownership.test.ts       # Channel scoping tests
│       └── slash-command-perms.test.ts   # Slash command permission tests

apps/web/
├── src/
│   ├── app/api/proxy/ws-ticket/route.ts  # NEW: Proxy route to obtain WS ticket
│   └── hooks/
│       └── use-config-updates.ts         # Updated: obtain ticket then connect WS

packages/db/
├── src/
│   └── schema/
│       └── channels.ts                   # Add approval_timeout_ms, channel_admins columns
│   └── migrations/                       # New migration for schema changes

packages/shared/
└── src/
    └── constants.ts                      # Command permission tier definitions
```

**Structure Decision**: Existing monorepo structure. Changes span `apps/api` (route handlers, agent logic), `apps/web` (WS ticket proxy, WS hook), `packages/db` (schema migration), and `packages/shared` (constants). No new packages or structural changes needed.

## Complexity Tracking

> No constitution violations — this section is not applicable.
