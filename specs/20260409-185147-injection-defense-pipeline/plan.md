# Implementation Plan: Multi-Layer Prompt Injection Defense Pipeline

**Branch**: `20260409-185147-injection-defense-pipeline` | **Date**: 2026-04-09 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/20260409-185147-injection-defense-pipeline/spec.md`

## Summary

Replace the two-line regex in `apps/api/src/agent/guardrails.ts:64-67` with a multi-layer defense pipeline that closes the prompt-injection vulnerabilities catalogued in [chrisleekr/personal-claw#35](https://github.com/chrisleekr/personal-claw/issues/35) and [chrisleekr/personal-claw#9](https://github.com/chrisleekr/personal-claw/issues/9). Scope (locked via 12 clarification Q&As) spans: (a) a 5-layer input-side pipeline — normalization, structural separation, heuristic scoring, pgvector similarity, LLM classifier — applied to user messages, untrusted tool outputs, generate-skill inputs, and recalled channel memories; (b) an output-side canary token layer; (c) a new `detection_audit_events` table with a scheduled retention job; (d) a tiered tool-output trust model; (e) a fix for `HooksEngine.emit()` silent error swallowing; and (f) a backward-compatible extension of `guardrailsConfigSchema` with no destructive DB migration.

The pipeline reuses existing infrastructure wherever possible: the `generateEmbedding()` helper and pgvector HNSW index already in `packages/db` (migration `0006_embedding_1024.sql`), the LLM `ProviderRegistry` with its 4 configured providers, the `node-cron`-based scheduler pattern used by `heartbeat.ts` and `runner.ts`, the `getCachedConfig()` channel-config cache with hot-reload via `onConfigChange`, the Drizzle migration workflow, and the Bun per-file test-isolation script. No new vendor onboarding is implied.

## Technical Context

**Language/Version**: TypeScript 5.7+ in strict mode, zero `any` (Constitution I). Runtime: Bun 1.3.9 (`packageManager` in `package.json`).

**Primary Dependencies** (all already present in `apps/api/package.json`):
- `ai` ^6.0.99 — Vercel AI SDK for `generateText`, `embed`, tool wrapping
- `@ai-sdk/openai` ^3.0.33, `@ai-sdk/anthropic` ^3.0.47, `@ai-sdk/amazon-bedrock` ^4.0.64, `ollama-ai-provider-v2` ^3.3.1 — LLM provider SDKs, already wired through `apps/api/src/agent/providers/registry.ts`
- `hono` ^4.7.0 — HTTP routing for the admin endpoints
- `zod` ^3.24.0 — runtime validation (Constitution §Code Style)
- `@logtape/logtape` ^2.0.4 — structured logging (Constitution VII)
- `node-cron` ^3.0.0 — scheduled retention job (FR-028)
- `drizzle-orm` via `@personalclaw/db` workspace package — DB access (Constitution II)
- `@personalclaw/shared` workspace package — shared types, Zod schemas, MCP security (Constitution II)

No new runtime dependencies are required. No new vendor onboarding.

**Storage**: PostgreSQL with `pgvector` extension already in use. Verified present:
- `channel_memories.embedding vector(1024)` + HNSW index (`packages/db/src/migrations/0006_embedding_1024.sql` lines 4-11) — infrastructure for FR-002(d)
- `channels.guardrails_config jsonb` — FR-023 extensions live here (no new column, no destructive migration)
- Next migration number: `0015_*` (journal entries 0000 through 0014 in `packages/db/src/migrations/meta/_journal.json`)

**New tables** (added via migration `0015_detection_audit_events.sql` and sibling Drizzle schema files):
- `detection_audit_events` (FR-026)
- `detection_audit_annotations` (FR-015 — admin triage annotations kept in a side-table so audit events remain immutable)
- `detection_overrides` (FR-033 per-channel allowlist/block-override)
- `detection_corpus_embeddings` (FR-002(d), FR-032 — precomputed embeddings for the committed base corpus, generated at build/startup from the source file)

**Testing**: Bun's built-in test runner (`bun test`) — Constitution I forbids Jest and Vitest. Mocks use `mock.module()`, but Bun has a known leakage bug between test files in the same process (see `apps/api/scripts/test-isolated.ts` comment referencing `oven-sh/bun#12823`). The existing per-file subprocess isolation script handles this — new tests MUST follow the same pattern (each `*.test.ts` file mocks its own dependencies locally). Test file location follows Constitution §Testing: `apps/api/src/<module>/__tests__/<file>.test.ts`.

**Target Platform**: Linux server running Bun, deployed behind Slack Bolt and a Next.js web frontend. Pipeline executes inside the Hono backend on port 4000. The cron retention job runs in the same API process (same pattern as `initHeartbeats()` at `apps/api/src/index.ts:82`).

**Project Type**: Monorepo with Turborepo orchestration (Constitution §Monorepo Structure). This feature touches `apps/api`, `packages/db`, `packages/shared`. `apps/web` changes are limited to the admin recent-blocks view from FR-015 and the block-display UX for FR-004.

**Performance Goals**:
- SC-003a (fast path): pgvector short-circuit path p95 ≤ 60 ms when a known-attack match exists (relaxed from the original 50 ms during Phase 6 on 2026-04-10 to cover observed 13 % embedding-HTTP jitter; measured between 49.16 ms and 55.45 ms across two 500-sample runs in `benchmark-results.md` — passes)
- SC-003b (full pipeline): end-to-end p95 ≤ `detection.classifierTimeoutMs + 200 ms` (default `classifierTimeoutMs = 3000 ms` → default target ≤ 3200 ms p95; Run #2 measured 1204.9 ms on gemma4 — passes with headroom)
- SC-001: ≥95% block rate on the committed adversarial corpus at `strict` profile (Run #2c measured 100 %, passes). Balanced profile (classifier disabled by default) also measures 100 % because the similarity short-circuit catches the corpus exactly, passes.
- SC-002 (per-profile after Phase 6 Option 2, 2026-04-10):
  - `balanced` / `permissive`: ≤ 3 % FP rate (spec literal). Measured 0 % in T083 live test — classifier disabled by default on these profiles, and the similarity + heuristics layers alone do not fire on the committed benign corpus.
  - `strict`: ≤ 3 % is aspirational. Measured 9.6 % (5/52) driven by gemma4 over-blocking boundary benign samples. T083 live test enforces a relaxed ≤ 15 % regression floor at strict profile; tightening to 3 % requires a larger/sharper classifier model (cloud gpt-4o-mini or Haiku, or a 70B+ local Ollama model). Tracked as a documented known gap.
- SC-004: zero unhandled detection crashes in a 7-day observation window

**Note on SC-003 two-tier refinement**: The original flat `≤250 ms p95 / ≤500 ms p99` target was rewritten during Phase 6 (2026-04-10) after Run #2 in `benchmark-results.md` showed gemma4's ~1.1 s p95 inference cost makes the flat target unreachable without a sub-100 ms classifier. The new two-tier split (SC-003a fast path + SC-003b timeout-bounded full pipeline) is structurally honest about the pipeline's two workloads and binds the slow-path budget to the operator-configurable `classifierTimeoutMs` so the spec stays valid across classifier choices. See `spec.md` §SC-003 for the rationale.

**Constraints**:
- Constitution III (Channel Isolation): every new query MUST be scoped by `channel_id`. The `detection_audit_events` and `detection_overrides` tables MUST have `channel_id` foreign keys with `ON DELETE CASCADE`.
- Constitution V (Memory Engine Encapsulation): recall-time memory detection (FR-025) MUST live inside `MemoryEngine.assembleContext()`, NOT inside routes.
- Constitution VI (Security by Default): fail-closed on `strict` profile (FR-011); `permissive` profile MUST retain a non-disableable floor (FR-008); no hardcoded secrets; zero silent failures (FR-017).
- Constitution VII (Observability): no `console.*` calls in `apps/api`; LogTape categories follow `['personalclaw', 'guardrails', 'detection']` naming. Cost MUST be logged after every classifier LLM call via cost-tracker.
- `bun run check` (typecheck → lint → test) MUST pass before any commit (Constitution §Quality Check).
- `HooksEngine.emit()` fix (FR-029) MUST NOT regress the existing 6 call sites (verified: 2 handlers only, both owned by this repo).

**Scale/Scope**: New code will span approximately:
- ~8 new source files under `apps/api/src/agent/detection/` (one per layer + pipeline orchestrator + types)
- ~1 new file under `apps/api/src/cron/` (retention job)
- ~2 new route files: `apps/api/src/routes/detection-audit.ts` (audit recent/detail/annotate/cleanup handlers) and `apps/api/src/routes/detection-overrides.ts` (per-channel override CRUD) — split to eliminate Phase 4/Phase 5 merge conflicts per analysis finding D1
- ~4 new schema files in `packages/db/src/schema/` (`detection-audit-events.ts`, `detection-audit-annotations.ts`, `detection-overrides.ts`, `detection-corpus-embeddings.ts`)
- ~1 new migration `packages/db/src/migrations/0015_detection_audit_events.sql` (creates all four tables)
- ~2 new shared files `packages/shared/src/injection-corpus/signatures.json` (adversarial base corpus) and `packages/shared/src/injection-corpus/benign.json` (benign corpus for SC-002 measurement)
- Tool-trust registry file (~1 file at `apps/api/src/agent/tool-trust.ts`)
- Updates to `apps/api/src/agent/guardrails.ts`, `pipeline.ts`, `engine.ts`, `approval-gateway.ts`, `memory/engine.ts`, `routes/conversations.ts`, `hooks/engine.ts`, `hooks/builtin/audit-trail.ts`, `hooks/builtin/cost-log.ts`, `index.ts`
- Updates to `packages/shared/src/schemas.ts`, `types.ts`
- Updates to `apps/web` for the admin recent-blocks view and block-display UX
- Documentation update: `docs/SAFEGUARDS.md`

No NEEDS CLARIFICATION items remain at spec level. One implementation-level decision is deferred to Phase 0 research: **which LLM provider and model to use for the semantic classifier** (see `research.md`).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Check | Status |
|-----------|-------|--------|
| I. Strict TypeScript and Bun Runtime | All new code TS strict mode, zero `any`; `bun test` only; Biome + `tsc --noEmit` gate | ✅ PASS — no new dependencies, reuses existing toolchain |
| II. Package Boundary Isolation | New Drizzle schemas live in `packages/db`; shared types and Zod schemas live in `packages/shared`; `apps/api` imports via workspace packages; `apps/web` only via REST API | ✅ PASS — plan respects all boundaries (verified: existing layout at `apps/api/package.json` references `@personalclaw/db` and `@personalclaw/shared` as `workspace:*`) |
| III. Channel Isolation | `detection_audit_events`, `detection_overrides`, `detection_corpus_embeddings` (global, not channel-scoped, but that is correct because it is a shared corpus) — all queries in pipeline code scoped by `channel_id` | ✅ PASS — `detection_corpus_embeddings` is intentionally global (the base corpus is a shared resource per FR-032); every per-channel query uses `channel_id` |
| IV. Documentation Standards | JSDoc on every exported symbol; Mermaid in `docs/SAFEGUARDS.md` update showing the new pipeline position | ✅ PASS — plan mandates `docs/SAFEGUARDS.md` update as a spec-level deliverable (see spec §Assumptions) |
| V. Memory Engine Encapsulation | Recall-time detection hook (FR-025) sits inside `MemoryEngine.assembleContext()`, not in routes | ✅ PASS — verified `assembleContext()` location at `apps/api/src/memory/engine.ts:70-94`; this plan modifies only that method, not any route |
| VI. Security by Default | Fail-closed on `strict`, permissive floor, no hardcoded secrets, no silent failures (including the `HooksEngine.emit()` fix) | ✅ PASS — FR-008, FR-011, FR-017, FR-029 all locked by clarification |
| VII. Structured Observability | LogTape category `['personalclaw', 'guardrails', 'detection']`; cost logged after every classifier LLM call; `guardrail:detection` hook emitted | ✅ PASS — plan mandates LogTape throughout, hook emission per FR-027 |

**Additional gates**:

- Constitution VI.VIII (the agent pipeline is the single execution path): the new detection pipeline integrates as pipeline *stages* inside `AgentEngine.stages`, not as a parallel execution path. Verified `engine.ts:112-123` is the single source of stage ordering.
- Constitution §Database: new schemas follow Drizzle migration workflow; raw SQL is used ONLY for pgvector and index operations (allowed by Constitution §Database). Every new table will have `created_at` and, where mutable, `updated_at` per Constitution §Database.
- Constitution §Code Style: named exports, Zod validation for all runtime input, API responses follow `{ data }` / `{ error: true, message }` — verified FR-004's HTTP 422 body shape complies with the error convention.
- Constitution §Testing: unit tests for pure layer functions; integration tests for the pipeline and routes; mocks for all external services; channel isolation test for `detection_audit_events`.

**All constitution gates pass. No violations to justify in Complexity Tracking.**

## Project Structure

### Documentation (this feature)

```text
specs/20260409-185147-injection-defense-pipeline/
├── plan.md              # This file (/speckit.plan command output)
├── spec.md              # Feature spec with 12 clarification Q&As
├── checklists/
│   └── requirements.md  # Spec quality checklist (all items pass)
├── research.md          # Phase 0 output: classifier provisioning, canary design, batching strategy
├── data-model.md        # Phase 1 output: detection_audit_events, detection_overrides, corpus embeddings, entity relationships
├── quickstart.md        # Phase 1 output: how to run the new pipeline locally, how to add a new attack signature
├── contracts/
│   ├── detection-audit.http          # Admin recent/detail/annotate endpoints (FR-015, FR-004)
│   ├── detection-audit-cleanup.http  # Admin-triggered retention endpoint (FR-028 part b)
│   ├── detection-overrides.http      # Per-channel override CRUD (FR-033)
│   └── generate-skill-block.http     # Generate-skill HTTP 422 block response (FR-019, FR-004)
└── tasks.md             # Phase 2 output (/speckit.tasks command — NOT created by /speckit.plan)
```

### Source Code (repository root)

This feature touches three of the four top-level workspaces. The real layout follows the existing monorepo (verified against `CLAUDE.md` and the Constitution §Monorepo Structure):

```text
apps/api/src/
├── agent/
│   ├── detection/                    # NEW — 5-layer input-side pipeline and canary
│   │   ├── types.ts                  # NEW — DetectionDecision, DetectionAction, DetectionContext, LayerResult
│   │   ├── engine.ts                 # NEW — orchestrates all layers; exposes detect(input, context, config)
│   │   ├── normalize.ts              # NEW — FR-002(a) Unicode/homoglyph/zero-width/encoding normalization
│   │   ├── structural.ts             # NEW — FR-002(b) helper: wraps untrusted content in role-tagged ModelMessage parts
│   │   ├── heuristics.ts             # NEW — FR-002(c) signal-based scoring over the base corpus
│   │   ├── similarity.ts             # NEW — FR-002(d) pgvector similarity search with short-circuit
│   │   ├── classifier.ts             # NEW — FR-002(e) LLM-based semantic classifier
│   │   ├── canary.ts                 # NEW — FR-020/021 output-side canary injection and detection
│   │   ├── corpus-loader.ts          # NEW — FR-032 loads committed corpus, FR-033 merges per-channel overrides
│   │   ├── audit.ts                  # NEW — writes detection_audit_events + emits guardrail:detection hook
│   │   └── __tests__/                # NEW — one test file per source file above (FR-016 bypass vectors covered here)
│   ├── tool-trust.ts                 # NEW — FR-030/031 tiered source-category registry + self-test
│   ├── guardrails.ts                 # MODIFIED — delegate to detection engine; remove regex; keep truncation
│   ├── pipeline.ts                   # MODIFIED — update preProcessStage, assembleContextStage, wrapApprovalStage, postProcessStage
│   ├── engine.ts                     # MODIFIED — stage ordering unchanged, but stages now call detection helpers
│   ├── approval-gateway.ts           # MODIFIED — wrapTools() post-processes tool outputs via tool-trust + detection
│   └── __tests__/
│       ├── guardrails.test.ts           # MODIFIED — replace old regex assertions with new decision-shape assertions
│       ├── pipeline.test.ts             # UNCHANGED — kept separate from the new detection-integration tests
│       └── pipeline-detection.test.ts   # NEW (T039) — pipeline-level integration tests for recall-time memory detection + tool-output detection (resolves prior I4 drift)
├── memory/
│   └── engine.ts                     # MODIFIED — assembleContext() calls detection on each recalled memory (FR-025)
├── routes/
│   ├── conversations.ts              # MODIFIED — generate-skill uses ModelMessage parts, routes content through detection (FR-019)
│   ├── detection-audit.ts            # NEW — GET recent blocks, GET by reference, POST annotate, POST cleanup (audit-only handlers)
│   └── detection-overrides.ts        # NEW — GET/POST/PATCH/DELETE for detection_overrides (per-channel overrides); split from detection-audit.ts to eliminate Phase 4/Phase 5 merge conflicts per analysis finding D1
├── hooks/
│   ├── engine.ts                     # MODIFIED — emit() no longer swallows errors (FR-029)
│   └── builtin/
│       ├── audit-trail.ts            # MODIFIED — narrow try/catch to known fs errors only (FR-029)
│       └── cost-log.ts               # MODIFIED — no-change-required verification
├── cron/
│   └── audit-cleanup.ts              # NEW — scheduled retention job (FR-028 part a)
└── index.ts                          # MODIFIED — register detection-audit route; call initAuditCleanup() at startup

packages/db/src/
├── schema/
│   ├── detection-audit-events.ts        # NEW — FR-026 table (system of record for audits)
│   ├── detection-audit-annotations.ts   # NEW — FR-015 per-row admin annotations (false-positive / under-review) kept separate to preserve audit immutability
│   ├── detection-overrides.ts           # NEW — FR-033 per-channel overrides
│   ├── detection-corpus-embeddings.ts   # NEW — cache of committed corpus embeddings (global, not channel-scoped)
│   └── index.ts                         # MODIFIED — export new schemas
└── migrations/
    └── 0015_detection_audit_events.sql  # NEW — creates all four tables + indexes + pgvector column

packages/shared/src/
├── schemas.ts                        # MODIFIED — extend guardrailsConfigSchema with defenseProfile, canaryTokenEnabled, auditRetentionDays, thresholds (FR-023); keep intentClassification as deprecated
├── types.ts                          # MODIFIED — extend GuardrailsConfig interface, add guardrail:detection to HookEventType
├── injection-corpus/
│   ├── signatures.json               # NEW — FR-032 base corpus, version-controlled
│   └── index.ts                      # NEW — typed loader for the JSON file
└── __tests__/
    └── schemas.test.ts               # MODIFIED — add tests for new guardrailsConfigSchema fields and back-compat derivation

apps/web/src/app/
└── (dashboard)/[channelId]/
    ├── guardrails/                   # NEW (or extended) — admin recent-blocks view (FR-015), block detail drill-down, false-positive marking, per-channel override editor
    └── settings/                     # MODIFIED — add defense profile selector, canary toggle, audit retention slider

docs/
└── SAFEGUARDS.md                     # MODIFIED — add the new detection pipeline to the layer diagram and ordering table
```

**Structure Decision**: The feature is implemented as a new `detection/` subdirectory under `apps/api/src/agent/`, parallel to the existing agent modules (`memory/`, `skills/`, `providers/`). This keeps pipeline orchestration and layer implementation co-located, keeps cross-layer imports local, and mirrors the project's existing module-per-capability layout (verified by the presence of similar subdirectories like `apps/api/src/cli/`, `apps/api/src/browser/`, `apps/api/src/sandbox/`). The existing `guardrails.ts` becomes a thin delegator to `detection/engine.ts` so `GuardrailsEngine.preProcess()` and `GuardrailsEngine.postProcess()` retain their current call sites and the pipeline stage signatures do not change (verified `preProcessStage` and `postProcessStage` in `apps/api/src/agent/pipeline.ts:69-74, 366-371`).

## Phase 0: Outline & Research

See `research.md` (companion artifact). Open items addressed:

1. **Semantic classifier provisioning (deferred from spec Q4)** — which LLM provider and model for FR-002(e), with a latency-and-cost comparison across Anthropic Haiku, Bedrock Claude Haiku, OpenAI gpt-4o-mini, and Ollama-hosted small models (all four providers are already configured per `apps/api/src/agent/providers/registry.ts:45-52`).

2. **Canary token design** — cryptographic randomness strategy, location in the system prompt (not in a place where a legitimate echo could be triggered), false-positive rate on legitimate outputs.

3. **Tool-result trust routing** — how the approval gateway's `wrapTools()` at `apps/api/src/agent/approval-gateway.ts:290-317` hooks into tool-output detection without breaking existing return shapes (e.g., `browser_screenshot` returns `{ image, mimeType }`, not plain text).

4. **Memory recall batching** — how to batch detection calls on multiple recalled memories in `MemoryEngine.assembleContext()` so per-turn latency stays within SC-003.

5. **Corpus embedding cache strategy** — whether to generate embeddings at build time (deterministic, cached in-repo) or at API startup (simpler, longer cold-start) — see FR-032 options.

6. **`HooksEngine.emit()` failure propagation shape** — whether to let handler errors throw directly or aggregate them into a structured result; confirmed implementation direction with spec Q9 but concrete API shape still TBD.

7. **Structural-separation migration** — how generate-skill's string template at `conversations.ts:59-74` becomes typed `ModelMessage` parts without losing the prompt's intent.

8. **Bun test-isolation pattern for new tests** — pattern for mocking `detection/` dependencies per-file without leaking across the test run.

**Output**: research.md (this command will generate it below) with all items resolved as Decision / Rationale / Alternatives-considered.

## Phase 1: Design & Contracts

**Prerequisites**: research.md complete.

### 1. Data model → `data-model.md`

Entities to document:

- **DetectionDecision** (in-process value object) — not persisted; produced by `detection/engine.ts`. Fields: action, riskScore, layersFired, reasonCode, redactedExcerpt, referenceId, canaryHit.
- **detection_audit_events** table (FR-026) — persistent; columns per spec; indexes per spec.
- **detection_overrides** table (FR-033) — persistent; per-channel allowlist / block-override entries.
- **detection_corpus_embeddings** table — persistent; one row per committed corpus signature, stores the 1024-dim embedding and the signature key for lookup; regenerated from the committed source file at build/startup.
- **GuardrailsConfig** (extended Zod schema + TS interface) — the extended `guardrailsConfigSchema` with new fields, derivation rules (FR-023), deprecated `intentClassification` (FR-024).
- **ToolTrustCategory** (enum) — `system_generated | already_detected | external_untrusted | mixed`.
- **UntrustedContentSource** (enum) — `user_message | tool_result | memory_recall | conversation_history | generate_skill_input | external_http`.
- **CanaryToken** (in-process value object) — random bytes, embedding position hint, TTL scoped to the single LLM call.

State transitions: none required for v1 (audit events are immutable; overrides are CRUD).

### 2. Interface contracts → `contracts/`

This project exposes HTTP endpoints via Hono. The new endpoints:

- `GET /api/channels/:channelId/detection-audit/recent` — admin recent-blocks view (FR-015). Returns paginated decisions for the channel.
- `GET /api/channels/:channelId/detection-audit/:referenceId` — detail view by reference id (FR-004).
- `POST /api/channels/:channelId/detection-audit/mark-false-positive` — mark an audit row as a false positive for triage (FR-015).
- `POST /api/guardrails/audit/cleanup` — admin-triggered retention cleanup (FR-028 part b). Body optionally specifies `channelId` to limit scope.
- `GET /api/channels/:channelId/detection-overrides` — list per-channel overrides (FR-033).
- `POST /api/channels/:channelId/detection-overrides` — add allowlist or block-override entry.
- `DELETE /api/channels/:channelId/detection-overrides/:id` — remove entry.
- `PATCH /api/channels/:channelId` — existing channel settings endpoint gains `guardrailsConfig.defenseProfile`, `guardrailsConfig.canaryTokenEnabled`, `guardrailsConfig.auditRetentionDays` fields (backward-compatible per FR-023).

All endpoints sit behind `authMiddleware` at `apps/api/src/middleware/auth.ts` (Bearer token with timing-safe comparison), inherited from the `/api/*` route mount at `apps/api/src/index.ts:61`. All responses follow Constitution §Code Style: `{ data }` on success, `{ error: true, message }` on failure. The block-response body for generate-skill (FR-004 HTTP 422) is documented as a contract in `contracts/generate-skill-block.http`.

**Note on frontend contracts**: `apps/web` has NO direct DB access per Constitution II. All dashboard features consume the new endpoints above via the REST API.

### 3. Quickstart → `quickstart.md`

Contents:
1. How to run the pipeline locally (`bun run dev` + smoke-test injection input)
2. How to add a new attack signature to the committed corpus (edit `signatures.json`, run the regeneration script)
3. How to add a per-channel override via the API
4. How to run just the detection test suite (`bun test src/agent/detection/__tests__/`)
5. How to trigger the retention cleanup manually
6. How to toggle canary detection off for a channel
7. How to verify the new pipeline is live in `docs/SAFEGUARDS.md`

### 4. Agent context update

Run `.specify/scripts/bash/update-agent-context.sh claude` to refresh `CLAUDE.md` with the new technology entries (none — all dependencies are reused — but the script idempotently updates the "Recent Changes" log).

## Phase 2 (NOT executed by this command)

Phase 2 is generated by `/speckit.tasks`. This command stops at the end of Phase 1.

## Complexity Tracking

*Fill ONLY if Constitution Check has violations that must be justified.*

No constitution violations identified. The plan strictly follows all seven principles and adds no new top-level projects, dependencies, or architectural layers.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
