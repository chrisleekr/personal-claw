# Implementation Plan: Support Embedding Provider for Ollama

**Branch**: `20260406-221125-ollama-embedding-provider` | **Date**: 2026-04-06 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/20260406-221125-ollama-embedding-provider/spec.md`
**Last Updated**: 2026-04-07 (PR review + spec analysis findings incorporated)

## Summary

Add Ollama as a third embedding provider alongside OpenAI and Bedrock. The existing `ollama-ai-provider-v2` package (v3.3.1) already supports the `embedding()` method with configurable dimensions, so the implementation is a straightforward extension of `apps/api/src/memory/embeddings.ts` with a new branch in `getEmbeddingProvider()` and `generateEmbedding()`. Default model: `mxbai-embed-large` (1024 dimensions native). No new dependencies required. No separate "configured" pre-check — misconfiguration triggers the existing graceful degradation path (FR-006).

**Implementation Status**: Core implementation complete (Phases 1-5). PR review fixes pending (Phase 6).

## Technical Context

**Language/Version**: TypeScript 5.7+ (strict mode, zero `any`) + Bun 1.3.9
**Primary Dependencies**: Hono (API), `ai` (Vercel AI SDK v6), `ollama-ai-provider-v2` v3.3.1 (already installed)
**Storage**: PostgreSQL with pgvector (1024-dimension embeddings, HNSW index)
**Testing**: Bun test runner (`bun test`)
**Target Platform**: Self-hosted server (Docker / local Bun)
**Project Type**: Web service (monorepo: apps/api + apps/web + packages/db + packages/shared)
**Performance Goals**: Embedding generation under 5 seconds for typical text (local Ollama inference)
**Constraints**: Must produce 1024-dimension vectors to match existing pgvector schema; must follow graceful degradation pattern
**Scale/Scope**: Single file change + config update + tests + docs

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Strict TypeScript and Bun Runtime | PASS | TypeScript strict, Bun runtime, Bun test runner only |
| II. Package Boundary Isolation | PASS | Embedding logic stays in `apps/api`; `EmbeddingProvider` type is local (not exported, no need for `packages/shared`) |
| III. Channel Isolation | N/A | Embedding generation is stateless — channel scoping applies at the memory layer, not here |
| IV. Documentation Standards | PASS | JSDoc on exported `generateEmbedding()` with `@param`, `@returns`, `@throws` tags; internal `getEmbeddingProvider()` also documented (RECOMMENDED, not MUST) |
| V. Memory Engine Encapsulation | PASS | Embeddings are called from within the memory engine (`LongTermMemory.save()`); no bypass |
| VI. Security by Default | PASS | No secrets hardcoded; Ollama URL from env via Zod schema; no new credentials needed |
| VII. Structured Observability | PASS | Existing LogTape logging in `LongTermMemory.save()` covers embedding failures |

**Pre-Phase 0 gate: PASS**
**Post-Phase 1 re-check: PASS** — no design changes affect constitution compliance.
**Post-implementation re-check (2026-04-07): PASS** — verified against actual code in PR #22.

## Project Structure

### Documentation (this feature)

```text
specs/20260406-221125-ollama-embedding-provider/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
apps/api/src/
├── memory/
│   └── embeddings.ts                          # MODIFIED — added ollama branch
└── memory/__tests__/
    └── embeddings.test.ts                     # MODIFIED — added Ollama tests

.env.example                                   # MODIFIED — documented ollama embedding config
docker-compose.yaml                            # MODIFIED — remapped host ports (25432, 26379)
CLAUDE.md                                      # MODIFIED — updated active technologies
.vscode/settings.json                          # MODIFIED — added cSpell words
```

**Structure Decision**: No new directories or packages. This feature extends existing files in the `apps/api/src/memory/` module. The `EmbeddingProvider` type is local to `embeddings.ts` (not exported from `packages/shared`). The existing `EMBEDDING_MODEL` env var handles model overrides — no new env vars needed in `config/index.ts`.

## Complexity Tracking

> No violations. The change is minimal — adding a third branch to an existing provider pattern.

## Requirement Coverage

All 7 functional requirements are covered by tasks. See tasks.md for full mapping.

| Requirement | Task Coverage | Status |
|-------------|--------------|--------|
| FR-001 (ollama as valid provider) | T001, T004, T006 | DONE |
| FR-002 (reuse base URL) | T005, T007 | DONE |
| FR-003 (independent model selection) | T005, T009 | DONE |
| FR-004 (mxbai-embed-large default) | T003, T008 | DONE |
| FR-005 (1024-dim compatible) | T005, T012, T019 | T019 pending |
| FR-006 (graceful degradation) | T016 | DONE |
| FR-007 (unreachable = graceful) | T014→T018, T020 | T018/T020 pending |

## PR Review Findings (2026-04-07)

11 review comments validated across Copilot and CodeRabbit on PR #22. All valid (6 unique issues + 3 duplicates + 1 partially valid).

### Must Fix (code/test correctness)

| # | Issue | Location | Action | Task |
|---|-------|----------|--------|------|
| 1 | T014 test has zero assertions — always passes | `embeddings.test.ts:162-185` | Refactor: add `embedThrowMessage` flag to top-level mock, use `expect(...).rejects.toThrow()` | T018 |
| 2 | No test asserts `providerOptions` passed to `embed()` | `embeddings.test.ts` (Ollama tests) | Add assertion: `expect(lastEmbedCall?.providerOptions).toEqual({ ollama: { dimensions: 1024 } })` | T019 |
| 3 | `.env.example` model tag mismatch: `mxbai-embed-large:latest` vs code `mxbai-embed-large` | `.env.example:29-30` | Comment out `EMBEDDING_MODEL`, fix documented default to `mxbai-embed-large` (no tag) | T017 |
| 4 | T015 marked complete in `tasks.md` but no test exists | `tasks.md:84` | Add the test using `embedThrowMessage` flag from T018 | T020 |
| 5 | `.env.example` changed default provider to `ollama` — breaks new users | `.env.example:27` | Revert default to `openai` or comment out with options shown | T017 |

### Should Fix (documentation)

| # | Issue | Location | Action | Task |
|---|-------|----------|--------|------|
| 6 | Triplicate "Recent Changes" entries | `CLAUDE.md:28-30` | Deduplicate to single entry; restore removed sandbox-env-allowlist entry | T021 |
| 7 | Quickstart snippet missing `providerOptions` for dimensions | `quickstart.md:39-42` | Add `providerOptions: { ollama: { dimensions: 1024 } }` | T022 |
| 8 | Research R5 "Decision" contradicts "Final decision revised" | `research.md:49-53` | Consolidate to final decision only | T023 |

### Low Priority (consistency)

| # | Issue | Location | Action | Task |
|---|-------|----------|--------|------|
| 9 | `createOllama()` instantiated per call vs module-level cache in LLM provider | `embeddings.ts:50` | Hoist to module level for consistency with `providers/ollama.ts` | T024 |

## Specification Analysis Findings (2026-04-07)

Cross-artifact analysis identified 11 findings (0 CRITICAL, 2 HIGH, 4 MEDIUM, 3 LOW). Key items requiring action:

### HIGH — Task status contradiction (I1)

T014 and T015 are marked `[x]` (complete) but annotated as DEFECTIVE. A task cannot be both complete and defective. Fix tasks T018 and T020 exist in Phase 6 to address this.

**Resolution**: In tasks.md, T014/T015 retain `[x]` to preserve history but are annotated with `DEFECTIVE` and cross-referenced to their fix tasks. This is an acceptable convention for this project — the `[x]` indicates the original attempt was made, and the defective annotation signals rework is needed.

### MEDIUM — Mock flag design for T018/T020 (U1)

T018 introduces `shouldThrowOnEmbed` as a boolean flag, but T020 needs a different error message (`'model "foo" not found'` vs `'Connection refused'`). A single boolean cannot differentiate.

**Resolution**: Use `embedThrowMessage: string | null` instead of `shouldThrowOnEmbed: boolean`. When non-null, the mock throws `new Error(embedThrowMessage)`. Both T018 and T020 set different messages. Updated in task descriptions.

### MEDIUM — FR-006/FR-007 near-duplication (D1)

FR-007 is a specific case of FR-006 (both mandate graceful degradation). FR-007 adds only the "no pre-check" implementation detail.

**Resolution**: Acceptable as-is. FR-007 provides an explicit clarification that prevents implementers from adding unnecessary health checks. No spec change needed.

### Coverage

- 100% requirement coverage (7/7 FRs have ≥1 task)
- 0 unmapped tasks
- SC-004 (under 5s) is an outcome metric validated during quickstart E2E (T026), not a dedicated perf task
