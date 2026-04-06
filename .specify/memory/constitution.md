<!--
Sync Impact Report
===================
Version change: 1.5.0 → 1.5.1
Modified sections (wording only, no semantic change):
  - Development Workflow > Pre-Commit Gate → reframed as LLM-actionable
    quality check (run `bun run check` after implementation)
  - Development Workflow > CI Gate → simplified to reference unified
    `bun run check` command
  - Development Workflow > Dependency Additions → removed stale
    "Current stack" version list
Added sections: None
Removed sections: None
Templates requiring updates:
  - .specify/templates/plan-template.md — ✅ compatible
  - .specify/templates/spec-template.md — ✅ compatible
  - .specify/templates/tasks-template.md — ✅ compatible
Follow-up TODOs:
  - ⚠ package.json: update "check" script to
    "bun run check-types && bun run lint && bun run test"
    and add "check:act": "act -W .github/workflows/ci.yml"
-->

# PersonalClaw Constitution

## Core Principles

### I. Strict TypeScript and Bun Runtime

All code MUST use TypeScript in strict mode with zero `any` types.
Bun is the sole runtime — Node.js-only APIs are prohibited. The Bun
built-in test runner (`bun test`) is the only permitted test framework;
Jest and Vitest are forbidden. Biome (`biome check`) handles linting
and formatting; `tsc --noEmit` handles type checking. Both MUST pass
before any PR merges.

**Rationale**: A single runtime eliminates environment drift.
Strict typing catches defects at compile time rather than production.

### II. Package Boundary Isolation

- All database access MUST go through `packages/db`. Importing `pg`,
  `postgres`, or `drizzle-orm` directly inside `apps/` is forbidden.
- All shared types and Zod schemas MUST live in `packages/shared`.
  Duplicating type definitions or schemas across apps is forbidden.
- `apps/web` MUST NOT import from `apps/api` or `packages/db`. The
  web frontend communicates exclusively via the Hono REST API.

**Rationale**: Package boundaries enforce separation of concerns and
prevent coupling that makes independent deployment impossible.

### III. Channel Isolation

Every database query MUST be scoped by `channel_id`. No query may
return or mutate data across channels.

**Rationale**: Channels represent independent workspaces with separate
identity, memory, tools, and budgets. Cross-channel data leakage is a
security and privacy violation.

### IV. Documentation Standards

All exported functions, classes, interfaces, and types MUST have JSDoc
comments. Repository-hosted explanatory documentation MUST use Mermaid
diagrams when a visual explanation materially improves reader
comprehension of a flow, structure, lifecycle, or interaction compared
with prose alone. Documentation MUST stay concise, MUST explain _what_
exists and _why_ it matters, and MUST avoid decorative diagrams that
do not add explanatory value.

- `@param`, `@returns`, and `@throws` tags MUST be present for public
  API functions that have multiple parameters, non-void return values,
  or documented error conditions.
- Internal (non-exported) helpers are RECOMMENDED to have JSDoc when
  logic is non-trivial, but it is not strictly required.
- Documentation MUST be updated in the same commit as any change that
  alters a symbol's observable behavior, signature, or semantics.
  Stale JSDoc is treated as a documentation defect.
- Repository docs that describe architecture, workflow, state changes,
  command flow, review flow, or other decision-heavy interactions MUST
  include a Mermaid diagram when that diagram makes the explanation
  faster or less ambiguous for readers.
- Mermaid diagrams MUST be authored for comprehension, not decoration.
  They MUST reflect the documented behavior accurately, use labels
  that stand on their own, and remain small enough to review without
  reverse-engineering the surrounding prose.
- Every Mermaid diagram introduced or modified in repository-hosted
  docs MUST be validated before merge. Invalid Mermaid syntax is
  treated as a documentation defect.
- Auto-derived types (e.g., `z.infer<typeof Schema>`) are exempt from
  inline JSDoc but MUST have a one-line comment at the declaration
  site identifying the source schema.
- `@deprecated` MUST be applied to any symbol scheduled for removal
  and MUST include a brief migration note pointing to the replacement.

**Rationale**: Stale or missing documentation creates knowledge silos
and slows onboarding. Requiring same-commit updates prevents
documentation drift from becoming systemic.

### V. Memory Engine Encapsulation

All memory operations (working, conversation, long-term) MUST go
through the MemoryEngine. Querying
`channel_memories` or `conversations` tables directly from routes or
handlers is forbidden.

**Rationale**: The memory engine manages the three-tier memory system
(Valkey working memory, Postgres conversation history, pgvector
semantic search) with compaction, decay, and recall tracking. Bypassing
it breaks consistency guarantees.

### VI. Security by Default

- Zero hardcoded secrets. All credentials come from environment
  variables validated by the Zod env schema at startup.
- API_SECRET MUST be >= 32 characters in production.
- MCP server configurations MUST be loaded from the database. Never
  hardcode MCP server URLs, stdio commands, or arguments in source
  code.
- MCP tool inputs are sanitised via the shared MCP security module
  (command whitelist, env blocklist, shell metachar detection, eval
  flag blocking, path traversal prevention). Never bypass MCP
  security validation.
- PII redaction is enabled by default in guardrails postProcessing.
  Never disable without explicit justification.
- Input content filtering (`contentFiltering: true`) is the default
  guardrail. Never weaken or remove without explicit justification.
- Autonomy level (`cautious` | `balanced` | `autonomous`) controls
  tool approval behavior exclusively through the approval gateway.
  Never hardcode tool approval logic elsewhere.
- Safe tool names come from channel approval policies in the DB and
  the `safeToolNames` set built in the pipeline — never hardcoded.
- The agent pipeline is the single execution path for all LLM
  interactions. Individual stages MUST NOT be bypassed or reordered
  outside the orchestrator.

**Rationale**: Defense-in-depth at every layer. The approval gateway,
MCP sanitisation, and content guardrails form a layered security model
that assumes any single layer can fail.

### VII. Structured Observability

- All backend logging in `apps/api` MUST use LogTape
  (`@logtape/logtape`). `console.log`, `console.warn`,
  `console.error`, and `console.info` are forbidden in `apps/api`.
- Logger category naming follows the pattern:
  `['personalclaw', '<module>', '<submodule>']`.
- Request-scoped context (channelId, requestId) MUST use
  `withContext()`.
- Cost MUST be logged after every `generateText` / `streamText` call
  via cost-tracker.
- Lifecycle hooks MUST emit at the correct points:
  `message:received`, `tool:called`, `memory:saved`,
  `message:sending`, `message:sent`.

**Rationale**: Structured JSON logging with category hierarchies and
request-scoped context enables filtering, alerting, and cost
attribution across channels without log parsing heuristics.

## Architecture Constraints

### Monorepo Structure

```text
apps/api      — Hono backend (port 4000), agent engine, platform adapters
apps/web      — Next.js 15 App Router frontend, Auth.js, shadcn/ui
packages/db   — Drizzle ORM schema, migrations, seed, database access
packages/shared — TypeScript types, Zod schemas, constants, MCP security
```

Turborepo orchestrates builds, tests, and type checks with caching.

### Provider Abstraction

The agent engine MUST be provider-agnostic. LLM interactions go through
an abstraction layer; never import provider SDKs directly in
application code.

### Code Style

- Named exports everywhere. Default exports ONLY for Next.js pages
  and layouts.
- One primary export per file for major modules.
- Barrel exports (`index.ts`) ONLY at package boundaries
  (`packages/*/src/index.ts`), never inside `apps/`.
- All runtime input validation uses Zod schemas from
  `@personalclaw/shared`.
- API responses: `{ data }` for success, `{ error: true, message }`
  for failures.
- Route files live in `apps/api/src/routes/` and export a Hono
  instance as a named export.

### Database

- All schema changes go through Drizzle migrations. Raw SQL is
  permitted ONLY for pgvector and tsvector operations.
- Every table MUST have `created_at` and `updated_at` columns.
- Never add a column without a migration. Never drop a migration file.

### Channel Integration

- Always extract `channelId`, `userId`, `threadId` from platform event
  context.
- Always acquire thread lock before agent execution to prevent race
  conditions.
- Always include `externalUserId` in logs, conversation records, and
  usage logs.

### Testing

- Unit tests for pure functions: compaction, cost calculation, prompt
  composition.
- Integration tests for API routes using Hono's test client.
- Mock all external services: Slack API, LLM provider APIs, MCP
  servers.
- Test channel isolation explicitly: verify no query leaks data across
  channels.
- Test file location: `apps/api/src/<module>/__tests__/<file>.test.ts`.

## Development Workflow

### Quality Check

After completing any implementation, `bun run check` MUST pass before
committing. This runs typecheck, lint, and test sequentially. Never
commit code that fails `bun run check`.

### CI Gate

The CI pipeline MUST pass on every PR before merge. It runs
`bun run check` (typecheck → lint → test) and `bun run build`.
Releases are driven by **semantic-release** on merge to `main`.

### Commit Messages

Follow Conventional Commits: `feat:`, `fix:`, `docs:`, `chore:`,
`refactor:`, `test:`, `perf:`, `build:`, `ci:`. Commitlint enforces
this via Husky's `commit-msg` hook. One logical change per commit.
Never commit `.env` files, secrets, or generated `dist/` directories.

### Branch Strategy

Feature branches off `main` MUST use timestamp naming:
`YYYYMMDD-HHMMSS-<slug>` (e.g., `20260404-130000-my-feature`).
Pass `--timestamp` when creating branches via the
`create-new-feature` script. Sequential numeric prefixes (`001-`)
MUST NOT be used for new branches; they cause numbering collisions
when multiple developers work in parallel. Direct pushes to `main`
are forbidden.

### Dependency Additions

New runtime dependencies MUST be justified in the PR description.
Security-sensitive dependencies (crypto, network, fs) require
explicit review of the package's maintenance status and known
vulnerabilities before adoption.

### Documentation Gate

PRs MUST comply with Principle IV (Documentation Standards). Reviewers
MUST reject PRs where exported symbols lack JSDoc, where JSDoc
describes outdated behavior, or where Mermaid diagrams are missing
for flows that would materially benefit from visual explanation.
Documentation updates MUST land in the same commit as the
implementation change — not as a follow-up.

## Governance

This constitution is the highest-authority document for PersonalClaw
development decisions. It supersedes all other practices, conventions,
or ad-hoc agreements.

### Amendment Procedure

1. Propose the change with rationale in a PR modifying this file.
2. The change MUST include a Sync Impact Report (HTML comment at top)
   documenting version bump, affected principles, and template updates.
3. Version follows semantic versioning:
   - **MAJOR**: Principle removed, redefined, or made backward
     incompatible.
   - **MINOR**: New principle or section added, or existing guidance
     materially expanded.
   - **PATCH**: Clarifications, wording fixes, non-semantic
     refinements.
4. All dependent templates (plan, spec, tasks) MUST be reviewed for
   consistency after any amendment.

### Compliance Review

- Every PR review MUST verify compliance with these principles.
- Complexity that violates a principle MUST be justified in the PR
  description with a specific rationale.
- Runtime guidance for AI agents is maintained in `AGENTS.md` and
  MUST stay consistent with this constitution.

**Version**: 1.5.1 | **Ratified**: 2026-04-06 | **Last Amended**: 2026-04-06
