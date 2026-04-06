# Tasks: Support Embedding Provider for Ollama

**Input**: Design documents from `/specs/20260406-221125-ollama-embedding-provider/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/

**Tests**: Not explicitly requested in the specification. Test tasks are included as they are essential for validating embedding provider correctness.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: No project initialization needed — this feature extends existing infrastructure. This phase handles the shared type change and documentation.

- [x] T001 [P] Add `'ollama'` to the `EmbeddingProvider` type union in `apps/api/src/memory/embeddings.ts`
- [x] T002 [P] Update `.env.example` to document `ollama` as a valid `EMBEDDING_PROVIDER` value with default model `mxbai-embed-large` in `.env.example`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core embedding provider wiring that all user stories depend on

**CRITICAL**: No user story work can begin until this phase is complete

- [x] T003 Add `DEFAULT_OLLAMA_EMBEDDING_MODEL` constant (`'mxbai-embed-large'`) in `apps/api/src/memory/embeddings.ts`
- [x] T004 Update `getEmbeddingProvider()` to return `'ollama'` when `config.EMBEDDING_PROVIDER === 'ollama'` in `apps/api/src/memory/embeddings.ts`
- [x] T005 Add Ollama embedding branch in `generateEmbedding()` that creates an Ollama provider instance via `createOllama()` and calls `embed()` with `ollama.embedding()` model in `apps/api/src/memory/embeddings.ts`. Import `createOllama` from `ollama-ai-provider-v2`. Use `config.OLLAMA_BASE_URL` for the base URL (fallback `http://localhost:11434/api`). Pass `EMBEDDING_DIMENSIONS` (1024) via provider options.

**Checkpoint**: Foundation ready — the Ollama embedding path is wired. User story validation can begin.

---

## Phase 3: User Story 1 - Configure Ollama as Embedding Provider (Priority: P1) MVP

**Goal**: Users can set `EMBEDDING_PROVIDER=ollama` and generate embeddings using a local Ollama instance with `mxbai-embed-large` as default model.

**Independent Test**: Set embedding provider to `ollama`, save a memory, verify embedding vector is stored in the database.

### Implementation for User Story 1

- [x] T006 [US1] Write unit test verifying `getEmbeddingProvider()` returns `'ollama'` when config is set to `'ollama'` in `apps/api/src/memory/__tests__/embeddings.test.ts`
- [x] T007 [US1] Write unit test verifying `generateEmbedding()` calls `createOllama` with correct base URL and invokes `embed()` with `ollama.embedding()` model when provider is `'ollama'` in `apps/api/src/memory/__tests__/embeddings.test.ts`
- [x] T008 [US1] Write unit test verifying `generateEmbedding()` uses `DEFAULT_OLLAMA_EMBEDDING_MODEL` (`'mxbai-embed-large'`) when no `EMBEDDING_MODEL` override is set in `apps/api/src/memory/__tests__/embeddings.test.ts`
- [x] T009 [US1] Write unit test verifying `generateEmbedding()` uses `config.EMBEDDING_MODEL` override when set for Ollama provider in `apps/api/src/memory/__tests__/embeddings.test.ts`
- [x] T010 [US1] Write unit test verifying `getEmbeddingProvider()` falls back to `'openai'` (not `'ollama'`) when `EMBEDDING_PROVIDER` is unset or an unknown value in `apps/api/src/memory/__tests__/embeddings.test.ts`
- [x] T011 [US1] Run `bun run check` to validate type-checking, linting, and all tests pass

**Checkpoint**: User Story 1 fully functional — Ollama embedding generation works with default and custom models.

---

## Phase 4: User Story 2 - Semantic Memory Search with Ollama Embeddings (Priority: P2)

**Goal**: Memories saved with Ollama-generated embeddings are retrievable via semantic search with correct relevance ranking.

**Independent Test**: Save several memories with Ollama embeddings, search for a related topic, verify results are returned ranked by similarity.

### Implementation for User Story 2

- [x] T012 [US2] Write unit test verifying `generateEmbedding()` for Ollama produces a `number[]` output compatible with the `embed()` return type in `apps/api/src/memory/__tests__/embeddings.test.ts`
- [x] T013 [US2] Verify existing `LongTermMemory.search()` works with Ollama-generated embeddings by reviewing that no provider-specific logic exists in `apps/api/src/memory/longterm.ts` (no code change expected — document finding)

**Checkpoint**: User Story 2 confirmed — semantic search works identically regardless of embedding provider.

---

## Phase 5: User Story 3 - Graceful Degradation When Ollama is Unavailable (Priority: P3)

**Goal**: When Ollama is unavailable, memory save operations succeed without embeddings and keyword search still works.

**Independent Test**: Configure Ollama provider, stop Ollama service, save a memory, verify it is stored without embedding and retrievable via keyword search.

### Implementation for User Story 3

- [x] T014 [US3] Write unit test verifying `generateEmbedding()` throws when Ollama is unreachable (connection refused) in `apps/api/src/memory/__tests__/embeddings.test.ts`
- [x] T015 [US3] Write unit test verifying `generateEmbedding()` throws when the configured Ollama model is not pulled/available in `apps/api/src/memory/__tests__/embeddings.test.ts`
- [x] T016 [US3] Verify existing graceful degradation in `LongTermMemory.save()` catches Ollama errors and saves without embedding — review `apps/api/src/memory/longterm.ts` (no code change expected — document that the existing try/catch handles this)

**Checkpoint**: User Story 3 confirmed — graceful degradation works for Ollama failures.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, JSDoc, and final validation

- [x] T017 [P] Add JSDoc comments to any new or modified exports in `apps/api/src/memory/embeddings.ts` per Constitution Principle IV
- [x] T018 [P] Update `docker-compose.yaml` if Ollama service definition is useful for local development (optional — skipped: Ollama runs natively for GPU access)
- [x] T019 Run full `bun run check` — typecheck, lint, and all tests must pass
- [ ] T020 Run quickstart.md validation: verify the documented steps work end-to-end with a running Ollama instance pulling `mxbai-embed-large`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on T001 (type change) — BLOCKS all user stories
- **User Stories (Phase 3-5)**: All depend on Foundational phase completion
  - US1, US2, US3 can proceed in priority order (P1 → P2 → P3)
  - US2 and US3 are lightweight validation phases with minimal code changes
- **Polish (Phase 6)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) — no dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) — validates search works (no code change expected)
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) — validates error handling (no code change expected)

### Within Each User Story

- Tests written before verifying implementation behavior
- Run `bun run check` at each checkpoint

### Parallel Opportunities

- T001 and T002 can run in parallel (different files)
- T006-T010 are all in the same test file — execute sequentially
- T017 and T018 can run in parallel (different files)

---

## Parallel Example: Phase 1

```bash
# Launch setup tasks in parallel (different files):
Task T001: "Add 'ollama' to EmbeddingProvider type in apps/api/src/memory/embeddings.ts"
Task T002: "Update .env.example with ollama embedding documentation"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001-T002)
2. Complete Phase 2: Foundational (T003-T005)
3. Complete Phase 3: User Story 1 (T006-T011)
4. **STOP and VALIDATE**: Test `EMBEDDING_PROVIDER=ollama` with a running Ollama instance
5. Deploy if ready — embeddings work with Ollama

### Incremental Delivery

1. Setup + Foundational → Ollama embedding wired
2. User Story 1 → Test independently → MVP ready
3. User Story 2 → Validate search works → Confirm compatibility
4. User Story 3 → Validate degradation → Confirm robustness
5. Polish → JSDoc, docs, full check

---

## Notes

- Default model is `mxbai-embed-large` (1024 dimensions native) — confirmed during clarification
- The core implementation is concentrated in Phase 2 (T003-T005) — a single file change to `embeddings.ts`
- User Stories 2 and 3 are primarily validation/testing phases — they confirm existing patterns work with the new provider rather than requiring new code
- No new dependencies needed — `ollama-ai-provider-v2` is already installed
- No database migrations needed — `vector(1024)` column is provider-agnostic
- Total estimated scope: ~50-80 lines of production code + ~100-150 lines of tests
