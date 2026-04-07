# Tasks: Fix Sandbox Command Allowlist Bypass

**Input**: Design documents from `/specs/20260407-184402-fix-sandbox-cmd-bypass/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, quickstart.md

**Analysis fixes applied**: C1 (rejected command logging), C2 (actionable error messages), C3 (JSDoc same-commit), C4 (terminology: validateDangerousArgs), C5 (manager.test.ts coverage), C6 (US1 scenario 3 scoped to default), C7 (test configs moved to foundational)

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2)
- Include exact file paths in descriptions

## Phase 1: Setup

**Purpose**: No new project setup needed. All changes are to existing files.

- [x] T001 Evaluate `safe-regex2` package for ReDoS validation; if suitable, install as dev/runtime dependency in `packages/shared/package.json`. If not, document the timeout-based fallback approach.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Update default configuration values and test configs that all user stories depend on. Test config updates are included here so `bun run check` passes at the checkpoint.

- [x] T002 [P] Remove `bash` and `sh` from `DEFAULT_SANDBOX_CONFIG.allowedCommands` and add `npx`, `bunx`, `sort`, `uniq` in `apps/api/src/sandbox/manager.ts` (lines 20-44)
- [x] T003 [P] Remove `bash` and `sh` from `sandboxConfigSchema` Zod defaults and add `npx`, `bunx`, `sort`, `uniq` in `packages/shared/src/schemas.ts` (lines 48-72)
- [x] T004 [P] Define `SHELL_INTERPRETERS` readonly set (`bash`, `sh`, `dash`, `zsh`, `csh`, `ksh`, `fish`) as an exported constant with JSDoc in `apps/api/src/sandbox/security.ts`
- [x] T005 Add shell interpreter warning with JSDoc in `SandboxCommandValidator` constructor: if any command in `config.allowedCommands` is in `SHELL_INTERPRETERS`, emit `logger.warn` with security advisory in `apps/api/src/sandbox/security.ts`
- [x] T006 [P] Update test config in `apps/api/src/sandbox/__tests__/security.test.ts` to remove `bash` and `sh` from `baseConfig.allowedCommands`
- [x] T007 [P] Update test config in `apps/api/src/sandbox/__tests__/direct.test.ts` to remove `bash` and `sh` from `testConfig.allowedCommands`
- [x] T008 [P] Update test config in `apps/api/src/sandbox/__tests__/bubblewrap.test.ts` to remove `bash` and `sh` from `testConfig.allowedCommands`
- [x] T009 [P] Update `packages/shared/src/__tests__/schemas.test.ts` assertion: replace `expect(result.allowedCommands).toContain('bash')` with `expect(result.allowedCommands).not.toContain('bash')` and add assertion for `npx`
- [x] T010 [P] Add tests in `apps/api/src/sandbox/__tests__/manager.test.ts` verifying `DEFAULT_SANDBOX_CONFIG` does not contain `bash`/`sh`, includes `npx`/`bunx`, and denied patterns are valid regex strings

**Checkpoint**: Default allowlist no longer includes shell interpreters. `bun run check` passes with updated test configs.

---

## Phase 3: US1 + US6 - Shell-Based Allowlist Bypass + Least-Privilege Defaults (Priority: P1)

**Goal**: Ensure `bash`/`sh` are rejected by the default allowlist and warn admins who override it. Combines User Story 1 (shell bypass prevention) and User Story 6 (least-privilege defaults) since they share the same implementation.

**Independent Test**: Submit `bash -c "dangerous_command"` and verify rejection. Inspect default allowlist and confirm no shell interpreters present.

### Implementation for US1 + US6

- [x] T011 [US1] Add test group `describe('shell interpreter warning')` in `apps/api/src/sandbox/__tests__/security.test.ts`: verify that constructing a validator with `bash` in allowedCommands triggers a logger warning (spy on LogTape)
- [x] T012 [US1] Add test cases in `apps/api/src/sandbox/__tests__/security.test.ts` for `describe('shell binary rejection')`: test `bash -c "cmd"`, `sh -c "cmd"`, `/bin/bash -c "cmd"` are all rejected with default config (bash not in allowlist)
- [x] T013 [US1] Add backward-compat test: verify `ls -la`, `git status`, `cat file.txt`, `echo hello` still pass with updated default config in `apps/api/src/sandbox/__tests__/security.test.ts`

**Checkpoint**: Default allowlist is shell-free. Shell commands rejected. Legitimate commands still work.

---

## Phase 4: US3 - Newline-Based Command Chaining (Priority: P1)

**Goal**: Block newline, carriage return, and null byte characters in the metacharacter filter to prevent multi-command injection.

**Independent Test**: Submit a command with embedded `\n` and verify it is rejected.

### Implementation for US3

- [x] T014 [P] [US3] Add `\n`, `\r`, and `\0` to `SHELL_METACHAR_PATTERN` regex character class in `apps/api/src/sandbox/security.ts` (line 79)
- [x] T015 [P] [US3] Add test group `describe('newline and null byte bypass')` in `apps/api/src/sandbox/__tests__/security.test.ts`: test commands containing `\n`, `\r`, `\0` are rejected with descriptive error message

**Checkpoint**: Newline-based command chaining is blocked.

---

## Phase 5: US2 - Interpreter-Based Bypass Vectors (Priority: P1)

**Goal**: Verify eval flags are allowed on allowlisted interpreters (sandbox is the security boundary, not eval flag blocking).

**Independent Test**: Submit `node -e "code"` and verify rejection. Submit `node script.js` and verify success.

### Implementation for US2

- [x] T016 [US2] [REVISED] Remove `hasEvalFlag` import and `INTERPRETER_BINARIES` from `apps/api/src/sandbox/security.ts` — eval flags are allowed (sandbox is the boundary)
- [x] T017 [US2] [REVISED] No eval flag blocking in `validateCommand()` — productive developer tool, not a security risk inside sandbox
- [x] T018 [US2] [REVISED] Verify `node -e`, `python3 -c`, `bun -e` all pass validation in `apps/api/src/sandbox/__tests__/security.test.ts`
- [x] T019 [P] [US2] [REVISED] Add test group `describe('eval flags allowed')` in `apps/api/src/sandbox/__tests__/security.test.ts`: verify all eval flag variants pass. Verify `node script.js` and `python3 script.py` also pass.

**Checkpoint**: Interpreter eval bypass is blocked. Legitimate interpreter usage works.

---

## Phase 6: US4 - Indirect Execution via Utility Flags (Priority: P2)

**Goal**: Block dangerous flags on utilities that can spawn subprocesses: `find -exec`, `git -c core.hooksPath`, `pip install` (uncontrolled), `curl -o` (outside workspace).

**Independent Test**: Submit `find . -exec cmd {} \;` and verify rejection. Submit `find . -name "*.ts"` and verify success.

### Implementation for US4

- [x] T020 [US4] Define `DANGEROUS_ARG_RULES` as a `ReadonlyMap<string, object>` with JSDoc in `apps/api/src/sandbox/security.ts` with per-binary rules: `find` blocks `-exec`/`-execdir`/`-delete`/`-ok`/`-okdir`; `git` blocks args matching `-c` followed by `core.hooksPath` or `core.sshCommand`; `pip` blocks `install` without version pinning; `curl` blocks `-o`/`--output`
- [x] T021 [US4] Add `validateDangerousArgs(binary: string, args: string[])` private method with JSDoc to `SandboxCommandValidator` in `apps/api/src/sandbox/security.ts` that looks up binary in `DANGEROUS_ARG_RULES` and checks args against the rule. Return actionable error messages with suggested alternatives (e.g., "Use `find . -name` instead of `find -exec`")
- [x] T022 [US4] Wire `validateDangerousArgs()` into `validateCommand()` in `apps/api/src/sandbox/security.ts`: call after binary allowlist check, before deniedPatterns check
- [x] T023 [P] [US4] Add test group `describe('per-binary dangerous args')` in `apps/api/src/sandbox/__tests__/security.test.ts`: test `find -exec`, `find -execdir`, `find -delete`, `git -c core.hooksPath=/evil pull`, `git -c core.sshCommand=evil fetch`, `pip install malicious-pkg`, `curl -o /usr/bin/payload url`. Verify rejection messages include alternatives. Also test legitimate variants: `find . -name "*.ts"`, `git clone url`, `git status`, `pip --version`, `curl https://api.example.com`

**Checkpoint**: Indirect execution via utility flags is blocked. Legitimate utility usage works.

---

## Phase 7: US5 - Robust Denied Patterns + ReDoS Protection (Priority: P2)

**Goal**: Upgrade default denied patterns to regex that catches flag reordering. Add ReDoS protection for user-supplied patterns.

**Independent Test**: Submit `rm -r -f /` and verify rejection. Submit a ReDoS pattern in config and verify it is rejected.

### Implementation for US5

- [x] T024 [US5] Replace literal denied patterns with robust regex strings in `apps/api/src/sandbox/manager.ts` (line 45): use `\\brm\\s+(-[a-z]*[rf][a-z]*\\s+)*\\/` pattern and equivalents per research.md R4
- [x] T025 [US5] Update matching denied patterns in `packages/shared/src/schemas.ts` (line 73) to use the same robust regex strings
- [x] T026 [US5] Add ReDoS validation `.refine()` to `deniedPatterns` array in `sandboxConfigSchema` in `packages/shared/src/schemas.ts`: validate each pattern string is safe before accepting the config. Use `safe-regex2` if installed (T001), otherwise implement a timeout-based test approach.
- [x] T027 [P] [US5] Add test group `describe('robust denied patterns')` in `apps/api/src/sandbox/__tests__/security.test.ts`: test `rm -rf /`, `rm -r -f /`, `rm -rf /*`, `rm -fr /`, `rm --recursive --force /` are all rejected. Test `rm file.txt` still passes.
- [x] T028 [P] [US5] Add test group `describe('ReDoS protection')` in `packages/shared/src/__tests__/schemas.test.ts`: test that a known ReDoS pattern is rejected by schema validation. Test that legitimate patterns are accepted.

**Checkpoint**: Denied patterns catch flag reordering. ReDoS patterns rejected at config time.

---

## Phase 8: Cross-Cutting - Rejected Command Logging + Error Messages

**Goal**: Ensure all rejected commands are logged for security audit (FR-006/SC-005) and include actionable alternative suggestions (FR-007/SC-004).

**Independent Test**: Submit a rejected command and verify (1) `logger.warn` is called with command and reason, (2) the error message includes a suggested alternative.

### Implementation

- [x] T029 [P] Add `logger.warn('Command rejected', { sandboxId, command, reason })` in `BubblewrapSandbox.exec()` in `apps/api/src/sandbox/bubblewrap.ts` when validation fails (before the early return at line 79)
- [x] T030 [P] Add `logger.warn('Command rejected', { sandboxId, command, reason })` in `DirectSandbox.exec()` in `apps/api/src/sandbox/direct.ts` when validation fails (before the early return at line 61)
- [x] T031 [P] Add test in `apps/api/src/sandbox/__tests__/bubblewrap.test.ts`: verify `logger.warn` is called when a command is rejected (spy on LogTape logger)
- [x] T032 [P] Add test in `apps/api/src/sandbox/__tests__/direct.test.ts`: verify `logger.warn` is called when a command is rejected (spy on LogTape logger)
- [x] T033 Add test in `apps/api/src/sandbox/__tests__/security.test.ts`: verify all rejection `reason` strings include an alternative suggestion substring

**Checkpoint**: All rejections are logged and include actionable suggestions.

---

## Phase 9: US7 - Bubblewrap Network Isolation (Priority: P2)

**Goal**: Enforce `networkAccess: false` by adding `--unshare-net` to bubblewrap arguments.

**Independent Test**: Set `networkAccess: false` in config and verify `--unshare-net` appears in bwrap args.

### Implementation for US7

- [x] T034 [US7] Add conditional `--unshare-net` with JSDoc update to `buildBwrapArgs()` in `apps/api/src/sandbox/bubblewrap.ts`: if `this.config.networkAccess === false`, push `'--unshare-net'` to args array (insert near line 200, alongside other `--unshare-*` flags)
- [x] T035 [P] [US7] Add test cases in `apps/api/src/sandbox/__tests__/bubblewrap.test.ts`: test `--unshare-net` is present in bwrap args when `networkAccess: false`; test `--unshare-net` is absent when `networkAccess: true`

**Checkpoint**: Bubblewrap enforces network isolation when configured.

---

## Phase 10: US8 - Workspace Size Limits (Priority: P3)

**Goal**: Enforce `maxWorkspaceSizeMb` via tmpfs size limits in bubblewrap.

**Independent Test**: Verify bwrap args contain the correct tmpfs size parameter.

### Implementation for US8

- [x] T036 [US8] Modify workspace mounting with JSDoc update in `buildBwrapArgs()` in `apps/api/src/sandbox/bubblewrap.ts`: change the `/tmp` tmpfs mount to include `--size` parameter based on `this.config.maxWorkspaceSizeMb`; or add a separate size-limited tmpfs for `/workspace` and adjust the `--bind` accordingly
- [x] T037 [P] [US8] Add test cases in `apps/api/src/sandbox/__tests__/bubblewrap.test.ts`: verify tmpfs args contain correct size value based on `maxWorkspaceSizeMb` config; test with different size values (64, 256)

**Checkpoint**: Bubblewrap enforces workspace size limits.

---

## Phase 11: Polish and Cross-Cutting Concerns

**Purpose**: Documentation, quality gate, and final validation

- [x] T038 [P] Update `docs/SAFEGUARDS.md` to document the new command validation layers (destructive arg blocking, newline filter, ReDoS protection, network isolation, workspace size enforcement, rejected command logging, and the "sandbox is the boundary" philosophy)
- [x] T039 Run `bun run check` (typecheck + lint + test) and fix any failures
- [x] T040 Run quickstart.md validation: verify all listed files were modified and all bypass vectors from spec are covered by tests

---

## Dependencies and Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - start immediately
- **Foundational (Phase 2)**: Depends on Setup - BLOCKS all user stories. Includes test config updates so checkpoint passes.
- **US1+US6 (Phase 3)**: Depends on Foundational (Phase 2)
- **US3 (Phase 4)**: Depends on Foundational (Phase 2) - can run in parallel with Phase 3
- **US2 (Phase 5)**: Depends on Foundational (Phase 2) - can run in parallel with Phases 3-4
- **US4 (Phase 6)**: Depends on Phase 5 (shares `validateCommand()` structure in security.ts)
- **US5 (Phase 7)**: Depends on Foundational (Phase 2) - can run in parallel with Phases 3-6
- **Logging/Errors (Phase 8)**: Depends on Phase 5 (needs rejection paths to exist). Can run in parallel with Phases 6-7.
- **US7 (Phase 9)**: Depends on Foundational (Phase 2) - independent file (bubblewrap.ts), can run in parallel with Phases 3-8
- **US8 (Phase 10)**: Depends on Phase 9 (same file, same method: `buildBwrapArgs`)
- **Polish (Phase 11)**: Depends on all phases complete

### User Story Dependencies

- **US1+US6 (P1)**: Independent after Foundational
- **US3 (P1)**: Independent after Foundational
- **US2 (P1)**: Independent after Foundational
- **US4 (P2)**: Depends on US2 structure (both add arg checks to `validateCommand()`)
- **US5 (P2)**: Independent after Foundational (different code section)
- **US7 (P2)**: Independent after Foundational (different file)
- **US8 (P3)**: Depends on US7 (same file, same method)

### Parallel Opportunities

```text
After Foundational (Phase 2) completes, these can run in parallel:
  +-- US1+US6 (Phase 3) - security.ts: allowlist + warning
  +-- US3 (Phase 4) - security.ts: metachar pattern (one-line change)
  +-- US2 (Phase 5) - security.ts: eval flag import + check
  +-- US5 (Phase 7) - schemas.ts + manager.ts: denied patterns
  +-- US7 (Phase 9) - bubblewrap.ts: network isolation

Sequential after parallel batch:
  +-- US4 (Phase 6) - after US2
  +-- Logging (Phase 8) - after US2
  +-- US8 (Phase 10) - after US7
```

---

## Implementation Strategy

### MVP First (P1 Stories: US1+US6, US2, US3)

1. Complete Phase 1: Setup (T001)
2. Complete Phase 2: Foundational (T002-T010)
3. Complete Phase 3: US1+US6 - Shell bypass + defaults (T011-T013)
4. Complete Phase 4: US3 - Newline bypass (T014-T015)
5. Complete Phase 5: US2 - Eval flag blocking (T016-T019)
6. **STOP and VALIDATE**: Run `bun run check`. All P1 bypass vectors should be blocked.

### Incremental Delivery

1. P1 stories (Phases 3-5) fix the critical exploits
2. P2 stories (Phases 6-10) add defense-in-depth
3. P3 story (Phase 10) adds workspace size enforcement
4. Each phase adds security value without breaking previous fixes

---

## Notes

- Most changes are in `apps/api/src/sandbox/security.ts` - coordinate carefully within that file
- `hasEvalFlag` from `packages/shared/src/mcp-security.ts` is NOT used by the sandbox validator (eval flags are allowed inside sandbox; MCP transport has its own stricter policy)
- Test configs in `__tests__/*.test.ts` are updated in Phase 2 (Foundational) so checkpoints pass
- JSDoc is added in the same task as implementation per Constitution Principle IV (not deferred)
- All rejection messages MUST include an actionable alternative suggestion (FR-007/SC-004)
- All rejected commands MUST be logged via LogTape `logger.warn` (FR-006/SC-005)
- The bubblewrap.ts changes (US7, US8) are independent from security.ts changes and can be developed in parallel
- Commit after each phase checkpoint for clean git history
