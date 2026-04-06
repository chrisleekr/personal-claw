# Tasks: Support Embedding Provider for Ollama

**Input**: Design documents from `/specs/20260406-221125-ollama-embedding-provider/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/

**Tests**: Included — tests are essential for validating embedding provider correctness.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story. Phases 1-5 reflect initial implementation (completed). Phase 6 addresses PR review findings. Phase 7 is final polish.

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

- [x] T014 [US3] Write unit test verifying `generateEmbedding()` throws when Ollama is unreachable (connection refused) in `apps/api/src/memory/__tests__/embeddings.test.ts` — **DEFECTIVE: test has zero assertions due to Bun module caching, see T018**
- [x] T015 [US3] Write unit test verifying `generateEmbedding()` throws when the configured Ollama model is not pulled/available in `apps/api/src/memory/__tests__/embeddings.test.ts` — **DEFECTIVE: test does not exist despite being marked complete, see T020**
- [x] T016 [US3] Verify existing graceful degradation in `LongTermMemory.save()` catches Ollama errors and saves without embedding — review `apps/api/src/memory/longterm.ts` (no code change expected — document that the existing try/catch handles this)

**Checkpoint**: User Story 3 confirmed — graceful degradation works for Ollama failures.

---

## Phase 6: PR Review Fixes

**Purpose**: Address 9 validated PR review findings from Copilot and CodeRabbit (11 comments total: 6 unique + 3 duplicates + 1 partially valid). See `plan.md > PR Review Findings (2026-04-07)` for full analysis.

### Must Fix (code/test correctness)

- [x] T017 [P] Fix `.env.example`: revert default `EMBEDDING_PROVIDER` from `ollama` to `openai`, comment out `EMBEDDING_MODEL` (remove active `mxbai-embed-large:latest`), and fix documented Ollama default in comment to `mxbai-embed-large` (no `:latest` tag) in `.env.example` — addresses PR review findings #3 and #5
- [x] T018 Add `embedThrowMessage: string | null = null` flag to top-level `ai` mock in `apps/api/src/memory/__tests__/embeddings.test.ts`: when non-null, the `embed` mock throws `new Error(embedThrowMessage)`. Reset to `null` in `beforeEach`. Refactor T014 test ("throws when embed() fails for ollama") to set `embedThrowMessage = 'Connection refused'` and use `await expect(generateEmbedding('test')).rejects.toThrow('Connection refused')`. Remove the inner `mock.module('ai', ...)` re-mock that Bun caching prevents from working — addresses PR review finding #1
- [x] T019 Add `providerOptions` assertion to the "uses ollama when configured" test: after the existing provider assertion, add `expect(lastEmbedCall?.providerOptions).toEqual({ ollama: { dimensions: 1024 } })` in `apps/api/src/memory/__tests__/embeddings.test.ts` — addresses PR review finding #2
- [x] T020 Add distinct T015 test for model-not-available scenario: add new test "throws when ollama model is not available" using the `embedThrowMessage` flag from T018 — set `embedThrowMessage = 'model "foo" not found, try pulling it first'` and assert `await expect(generateEmbedding('test')).rejects.toThrow('model')` in `apps/api/src/memory/__tests__/embeddings.test.ts` — depends on T018 — addresses PR review finding #4

### Should Fix (documentation)

- [x] T021 [P] Deduplicate `CLAUDE.md` Recent Changes: keep single entry for `20260406-221125-ollama-embedding-provider`, restore the `20260406-201317-sandbox-env-allowlist` entry that was removed in `CLAUDE.md` — addresses PR review finding #6
- [x] T022 [P] Update quickstart snippet to include `providerOptions: { ollama: { dimensions: 1024 } }` in the `embed()` call example in `specs/20260406-221125-ollama-embedding-provider/quickstart.md` — addresses PR review finding #7
- [x] T023 [P] Consolidate research R5 decision: replace contradictory "Decision" + "Final decision revised" with single clear decision statement ("Use existing `EMBEDDING_MODEL` env var — do NOT add `OLLAMA_EMBEDDING_MODEL`") in `specs/20260406-221125-ollama-embedding-provider/research.md` — addresses PR review finding #8

### Low Priority (consistency)

- [x] T024 [P] ~~Hoist `createOllama()` to module-level cached instance~~ — **SKIPPED**: hoisting breaks test isolation because `config.OLLAMA_BASE_URL` is read at module init time via the Proxy mock, before per-test `mockConfigValues` are set. The per-call pattern is correct for testability. — addresses PR review finding #9

**Checkpoint**: All PR review findings addressed.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final validation and quality gate

- [x] T025 Run full `bun run check` — typecheck, lint, and all tests must pass
- [ ] T026 Run quickstart.md validation: verify the documented steps work end-to-end with a running Ollama instance pulling `mxbai-embed-large`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — **COMPLETED**
- **Foundational (Phase 2)**: Depends on T001 — **COMPLETED**
- **User Stories (Phase 3-5)**: All depend on Phase 2 — **COMPLETED**
- **PR Review Fixes (Phase 6)**: Depends on all user stories being complete
  - T018 must complete before T020 (T020 depends on `embedThrowMessage` flag from T018)
  - T017, T019, T021, T022, T023, T024 are independent of each other and of T018
- **Polish (Phase 7)**: Depends on Phase 6 completion

### User Story Dependencies

- **User Story 1 (P1)**: COMPLETED
- **User Story 2 (P2)**: COMPLETED
- **User Story 3 (P3)**: COMPLETED (with test gaps addressed in Phase 6 via T018, T020)

### Within Phase 6

- T017, T019, T021, T022, T023, T024 can all run in parallel (different files or independent concerns)
- T018 must complete before T020 (shared mock flag dependency)

### Parallel Opportunities

- Phase 6 has 6 independent tasks that can run in parallel: T017, T019, T021, T022, T023, T024
- T018 is a sequential dependency for T020
- Total: 8 remaining tasks across Phase 6 + Phase 7

---

## Parallel Example: Phase 6

```bash
# Launch independent fixes in parallel (different files):
Task T017: "Fix .env.example defaults and model tag"
Task T019: "Add providerOptions assertion to Ollama test"
Task T021: "Deduplicate CLAUDE.md Recent Changes"
Task T022: "Update quickstart.md snippet with providerOptions"
Task T023: "Consolidate research.md R5 decision"
Task T024: "Hoist createOllama() to module level in embeddings.ts"

# Then sequential test fixes (T020 depends on T018):
Task T018: "Add embedThrowMessage flag and fix T014 test"
Task T020: "Add T015 model-not-available test" (after T018)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. ~~Complete Phase 1: Setup (T001-T002)~~ **DONE**
2. ~~Complete Phase 2: Foundational (T003-T005)~~ **DONE**
3. ~~Complete Phase 3: User Story 1 (T006-T011)~~ **DONE**
4. ~~STOP and VALIDATE~~ **DONE**

### Current: PR Review Fix Phase

5. Complete Phase 6: PR Review Fixes (T017-T024)
   - Start with parallel tasks: T017, T019, T021, T022, T023, T024
   - Then T018 (test refactor), then T020 (depends on T018)
6. Complete Phase 7: Polish (T025-T026)

### Incremental Delivery

1. ~~Setup + Foundational → Ollama embedding wired~~ **DONE**
2. ~~User Story 1 → MVP ready~~ **DONE**
3. ~~User Story 2 → Confirm compatibility~~ **DONE**
4. ~~User Story 3 → Confirm robustness~~ **DONE**
5. PR Review Fixes → Address all 9 findings → Quality gate
6. Polish → Full check, quickstart validation

---

## Notes

- Default model is `mxbai-embed-large` (1024 dimensions native) — confirmed during clarification
- The core implementation is concentrated in Phase 2 (T003-T005) — a single file change to `embeddings.ts`
- User Stories 2 and 3 are primarily validation/testing phases — they confirm existing patterns work with the new provider rather than requiring new code
- No new dependencies needed — `ollama-ai-provider-v2` is already installed
- No database migrations needed — `vector(1024)` column is provider-agnostic
- Phase 6 addresses 9 validated PR review findings (11 comments from Copilot/CodeRabbit: 6 unique + 3 duplicates + 1 partially valid)
- The most impactful fix is T018 — the current T014 test has zero assertions and always passes due to Bun module caching
- T015 was incorrectly marked complete in the original tasks — no corresponding test exists in the codebase
