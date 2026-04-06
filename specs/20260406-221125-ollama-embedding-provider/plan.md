# Implementation Plan: Support Embedding Provider for Ollama

**Branch**: `20260406-221125-ollama-embedding-provider` | **Date**: 2026-04-06 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/20260406-221125-ollama-embedding-provider/spec.md`

## Summary

Add Ollama as a third embedding provider alongside OpenAI and Bedrock. The existing `ollama-ai-provider-v2` package (v3.3.1) already supports the `embedding()` method with configurable dimensions, so the implementation is a straightforward extension of `apps/api/src/memory/embeddings.ts` with a new branch in `getEmbeddingProvider()` and `generateEmbedding()`. Default model: `mxbai-embed-large` (1024 dimensions native). No new dependencies required. No separate "configured" pre-check — misconfiguration triggers the existing graceful degradation path (FR-006).

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
| II. Package Boundary Isolation | PASS | Embedding logic stays in `apps/api`; no direct DB imports; shared types in `packages/shared` |
| III. Channel Isolation | N/A | Embedding generation is stateless — channel scoping applies at the memory layer, not here |
| IV. Documentation Standards | PASS | Will add JSDoc to new/modified exports |
| V. Memory Engine Encapsulation | PASS | Embeddings are called from within the memory engine; no bypass |
| VI. Security by Default | PASS | No secrets hardcoded; Ollama URL from env via Zod schema; no new credentials needed |
| VII. Structured Observability | PASS | Existing LogTape logging in memory engine covers embedding failures |

**Pre-Phase 0 gate: PASS**
**Post-Phase 1 re-check: PASS** — no design changes affect constitution compliance.

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
│   └── embeddings.ts                          # MODIFY — add ollama branch
└── memory/__tests__/
    └── embeddings.test.ts                     # CREATE — unit tests

.env.example                                   # MODIFY — document ollama embedding config
```

**Structure Decision**: No new directories or packages. This feature extends existing files in the `apps/api/src/memory/` module. The `EmbeddingProvider` type is local to `embeddings.ts` (not exported from `packages/shared`). The existing `EMBEDDING_MODEL` env var handles model overrides — no new env vars needed in `config/index.ts`.

## Complexity Tracking

> No violations. The change is minimal — adding a third branch to an existing provider pattern.
