# Tasks: Sandbox Environment Variable Allowlist

**Input**: Design documents from `/specs/20260406-201317-sandbox-env-allowlist/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md

**Tests**: Included — FR-009 explicitly requires automated tests.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: No project initialization needed — this is a modification to an existing codebase. Skip to Phase 2.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Add shared constants and validation functions that ALL user stories depend on

**CRITICAL**: No user story work can begin until this phase is complete

- [x] T001 Add `SAFE_ENV_VARS` constant (readonly array of `PATH`, `HOME`, `LANG`, `TERM`, `USER`, `SHELL`, `TMPDIR`) with JSDoc to `apps/api/src/sandbox/security.ts`
- [x] T002 Add `ALLOWED_GIT_TOKEN_VARS` regex constant matching `GH_TOKEN`, `GITHUB_TOKEN`, `GIT_TOKEN`, `GITLAB_TOKEN` with JSDoc to `apps/api/src/sandbox/security.ts`
- [x] T003 Add `validateGitTokenEnvVar()` function that throws an `Error` for disallowed variable names and logs a warning via LogTape (category `['personalclaw', 'sandbox', 'security']`) to `apps/api/src/sandbox/security.ts`
- [x] T004 Add `buildSandboxEnv()` function that constructs env from allowlisted host vars + provider vars + caller vars (precedence: allowlist then envVars then options.env) with JSDoc to `apps/api/src/sandbox/security.ts`
- [x] T005 Export `SAFE_ENV_VARS`, `ALLOWED_GIT_TOKEN_VARS`, `validateGitTokenEnvVar`, and `buildSandboxEnv` from `apps/api/src/sandbox/security.ts`

**Checkpoint**: Shared security functions ready — user story implementation can now begin

---

## Phase 3: User Story 1 — Sandbox Prevents Host Secret Leakage (Priority: P1) MVP

**Goal**: Replace `...Bun.env` spread in DirectSandbox with the hardcoded allowlist so sandboxed commands can never access host secrets

**Independent Test**: Run `printenv` inside a DirectSandbox and verify only allowlisted + explicitly configured variables appear

### Tests for User Story 1

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T006 [US1] Add unit test: `buildSandboxEnv()` returns only allowlisted host vars when no extras provided, in `apps/api/src/sandbox/__tests__/security.test.ts`
- [x] T007 [US1] Add unit test: `buildSandboxEnv()` includes provider `envVars` and caller `options.env` alongside allowlisted vars, in `apps/api/src/sandbox/__tests__/security.test.ts`
- [x] T008 [US1] Add unit test: `buildSandboxEnv()` allows `options.env` to override allowlisted values (e.g., custom `PATH`), in `apps/api/src/sandbox/__tests__/security.test.ts`
- [x] T009 [US1] Add unit test: `buildSandboxEnv()` excludes sensitive vars (`DATABASE_URL`, `OPENAI_API_KEY`, `AWS_SECRET_ACCESS_KEY`) even when set on host, in `apps/api/src/sandbox/__tests__/security.test.ts`
- [x] T010 [US1] Add unit test: `buildSandboxEnv()` handles missing allowlisted vars gracefully (no error when e.g., `LANG` is unset), in `apps/api/src/sandbox/__tests__/security.test.ts`
- [x] T010a [US1] Add unit test: `buildSandboxEnv()` allows provider `envVars` to override allowlisted values when they collide (e.g., provider sets `PATH`), in `apps/api/src/sandbox/__tests__/security.test.ts`

### Implementation for User Story 1

- [x] T011 [US1] Replace `...Bun.env` spread in `DirectSandbox.exec()` method with call to `buildSandboxEnv()` in `apps/api/src/sandbox/direct.ts`
- [x] T012 [US1] Add one integration smoke test: create DirectSandbox, run `printenv`, assert no sensitive vars in output, in `apps/api/src/sandbox/__tests__/direct.test.ts`
- [x] T013 [US1] Run `bun run check` to verify typecheck + lint + all existing tests pass

**Checkpoint**: DirectSandbox no longer leaks host secrets — User Story 1 is independently testable

---

## Phase 4: User Story 2 — Git Token Variable Validation (Priority: P2)

**Goal**: Validate `gitTokenEnvVar` against strict allowlist and throw error (fail-closed) for disallowed names

**Independent Test**: Attempt to create a sandbox with `gitTokenEnvVar` set to `DATABASE_URL` and verify it throws

### Tests for User Story 2

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T014 [US2] Add unit test: `validateGitTokenEnvVar()` accepts `GH_TOKEN`, `GITHUB_TOKEN`, `GIT_TOKEN`, `GITLAB_TOKEN`, in `apps/api/src/sandbox/__tests__/security.test.ts`
- [x] T015 [US2] Add unit test: `validateGitTokenEnvVar()` throws for `DATABASE_URL`, `AWS_SECRET_ACCESS_KEY`, arbitrary strings, in `apps/api/src/sandbox/__tests__/security.test.ts`
- [x] T016 [US2] Add unit test: `validateGitTokenEnvVar()` accepts `null` and empty string (no-op), in `apps/api/src/sandbox/__tests__/security.test.ts`

### Implementation for User Story 2

- [x] T017 [US2] Add `validateGitTokenEnvVar()` call in `DirectProvider.create()` before reading `Bun.env[gitTokenEnvVar]` in `apps/api/src/sandbox/direct.ts`
- [x] T018 [US2] Add test: `DirectProvider.create()` throws when `gitTokenEnvVar` is `DATABASE_URL`, in `apps/api/src/sandbox/__tests__/direct.test.ts`
- [x] T019 [US2] Add test: `DirectProvider.create()` succeeds when `gitTokenEnvVar` is `GH_TOKEN`, in `apps/api/src/sandbox/__tests__/direct.test.ts`
- [x] T020 [US2] Run `bun run check` to verify typecheck + lint + all existing tests pass

**Checkpoint**: DirectSandbox rejects arbitrary `gitTokenEnvVar` — User Story 2 is independently testable

---

## Phase 5: User Story 3 — Bubblewrap Sandbox Parity (Priority: P3)

**Goal**: Apply the same allowlist and `gitTokenEnvVar` validation to BubblewrapSandbox so security posture is consistent across both providers

**Independent Test**: Unit test `buildBwrapArgs` output to verify only allowlisted env vars appear in `--setenv` arguments; verify `gitTokenEnvVar` validation throws for disallowed names

### Tests for User Story 3

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T021 [P] [US3] Add unit test: `BubblewrapProvider.create()` throws when `gitTokenEnvVar` is `DATABASE_URL`, in `apps/api/src/sandbox/__tests__/bubblewrap.test.ts`
- [x] T022 [P] [US3] Add unit test: `BubblewrapProvider.create()` succeeds when `gitTokenEnvVar` is `GH_TOKEN`, in `apps/api/src/sandbox/__tests__/bubblewrap.test.ts`
- [x] T022a [US3] Add unit test: `buildSandboxEnv()` produces identical output regardless of which provider calls it (SC-004 parity), in `apps/api/src/sandbox/__tests__/security.test.ts`

### Implementation for User Story 3

- [x] T023 [US3] Add `validateGitTokenEnvVar()` call in `BubblewrapProvider.create()` before reading `Bun.env[gitTokenEnvVar]` in `apps/api/src/sandbox/bubblewrap.ts`
- [x] T024 [US3] Update `BubblewrapSandbox.buildBwrapArgs()` to use `buildSandboxEnv()` for `--setenv` arguments instead of passing `this.envVars` directly, in `apps/api/src/sandbox/bubblewrap.ts`
- [x] T025 [US3] Wrap bwrap integration tests in `describe.skipIf(process.platform !== "linux")` in `apps/api/src/sandbox/__tests__/bubblewrap.test.ts`
- [x] T026 [US3] Run `bun run check` to verify typecheck + lint + all existing tests pass

**Checkpoint**: Both sandbox providers enforce identical environment restrictions

---

## Phase 6: Polish and Cross-Cutting Concerns

**Purpose**: Final validation and documentation

- [x] T027 Verify JSDoc is present on all new exported functions and constants in `apps/api/src/sandbox/security.ts`
- [x] T028 Run full `bun run check` (typecheck + lint + test) from repo root
- [x] T029 Run quickstart.md validation: review breaking change impact on existing callers

---

## Phase 7: Post-Review Fixes (from /pr-senior-review)

**Purpose**: Address issues found during senior code review

### High Priority

- [x] T030 Fix bwrap PATH/HOME override: delete `HOME` and `PATH` from `mergedEnv` before the `--setenv` loop in `apps/api/src/sandbox/bubblewrap.ts:buildBwrapArgs()`
- [x] T031 Move `validateGitTokenEnvVar()` before `mkdir()` in `apps/api/src/sandbox/direct.ts:DirectProvider.create()`
- [x] T032 Move `validateGitTokenEnvVar()` before `mkdir()` in `apps/api/src/sandbox/bubblewrap.ts:BubblewrapProvider.create()`

### Medium Priority

- [x] T033 Add `expect(result.exitCode).toBe(0)` assertion to the env leak smoke test in `apps/api/src/sandbox/__tests__/direct.test.ts`

### Low Priority

- [x] T034 Add missing `await` to `expect(...).rejects.toThrow(...)` in `apps/api/src/sandbox/__tests__/direct.test.ts` (1 location in PR scope)
- [x] T035 Add missing `await` to `expect(...).rejects.toThrow(...)` in `apps/api/src/sandbox/__tests__/bubblewrap.test.ts` (1 location)

### Validation

- [x] T036 Run `bun run check` to verify all fixes pass typecheck + lint + test

---

## Dependencies and Execution Order

### Phase Dependencies

- **Foundational (Phase 2)**: No dependencies — can start immediately
- **User Story 1 (Phase 3)**: Depends on Phase 2 completion (needs `buildSandboxEnv`)
- **User Story 2 (Phase 4)**: Depends on Phase 2 completion (needs `validateGitTokenEnvVar`); independent of US1
- **User Story 3 (Phase 5)**: Depends on Phase 2 completion; independent of US1 and US2
- **Polish (Phase 6)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Depends on T001, T004, T005 only — no cross-story dependencies
- **User Story 2 (P2)**: Depends on T002, T003, T005 only — can run in parallel with US1
- **User Story 3 (P3)**: Depends on T001-T005 — can run in parallel with US1 and US2

### Within Each User Story

- Tests MUST be written and FAIL before implementation
- Implementation tasks are sequential within each story
- `bun run check` at end of each story confirms no regressions

### Parallel Opportunities

- T006-T010a (US1 unit tests) are sequential within `security.test.ts` but independent test cases
- T014-T016 (US2 unit tests) are sequential within `security.test.ts` but independent test cases
- T021, T022 (US3 tests) can run in parallel (different files: bubblewrap.test.ts vs security.test.ts for T022a)
- After Phase 2, all three user stories (Phase 3, 4, 5) can proceed in parallel

---

## Parallel Example: User Story 1

```text
# Launch all unit tests for US1 together:
Task: "Unit test buildSandboxEnv returns only allowlisted vars" in security.test.ts
Task: "Unit test buildSandboxEnv includes provider and caller vars" in security.test.ts
Task: "Unit test buildSandboxEnv allows options.env override" in security.test.ts
Task: "Unit test buildSandboxEnv excludes sensitive vars" in security.test.ts
Task: "Unit test buildSandboxEnv handles missing vars" in security.test.ts

# Then implement sequentially:
Task: "Replace ...Bun.env spread with buildSandboxEnv call" in direct.ts
Task: "Integration smoke test with printenv" in direct.test.ts
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 2: Foundational (add shared constants and functions)
2. Complete Phase 3: User Story 1 (fix DirectSandbox env spread)
3. **STOP and VALIDATE**: Run `printenv` in a DirectSandbox — zero secrets should appear
4. This alone closes the primary attack vector

### Incremental Delivery

1. Foundational complete -> shared security functions ready
2. Add User Story 1 -> DirectSandbox secured -> test independently (MVP)
3. Add User Story 2 -> gitTokenEnvVar validated -> test independently
4. Add User Story 3 -> BubblewrapSandbox at parity -> test independently
5. Each story adds defense-in-depth without breaking previous stories

---

## Notes

- [P] tasks = different files or independent test cases, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story is independently completable and testable
- Commit after each phase checkpoint
- All test tasks target existing test files (no new test files needed)
- FR-009 requires tests, so test tasks are included for all stories
