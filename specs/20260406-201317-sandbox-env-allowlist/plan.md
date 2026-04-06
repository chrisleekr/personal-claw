# Implementation Plan: Sandbox Environment Variable Allowlist

**Branch**: `20260406-201317-sandbox-env-allowlist` | **Date**: 2026-04-06 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/20260406-201317-sandbox-env-allowlist/spec.md`

## Summary

Replace the `...Bun.env` spread in `DirectSandbox.exec()` with a hardcoded allowlist of safe environment variables, validate `gitTokenEnvVar` against a strict set of known token variable names (fail-closed), and apply the same restrictions to `BubblewrapSandbox` for parity. Add unit tests for env construction and one integration smoke test.

## Technical Context

**Language/Version**: TypeScript 5.7+ (strict mode, zero `any`)
**Primary Dependencies**: Bun 1.3.9 (runtime + test runner), Hono (API framework), LogTape (logging)
**Storage**: N/A (no database changes for this feature)
**Testing**: `bun test` via `scripts/test-isolated.ts` (per-file isolation for `mock.module` leakage workaround)
**Target Platform**: Linux (production with bubblewrap), macOS (development with direct sandbox)
**Project Type**: Monorepo — `apps/api` (Hono backend), `apps/web` (Next.js), `packages/shared`, `packages/db`
**Performance Goals**: N/A (security fix, no performance-sensitive paths)
**Constraints**: Constitution Principle VI (Security by Default), Principle I (strict TypeScript, Bun-only)
**Scale/Scope**: 3 source files modified, 3 test files updated, approximately 100 lines changed

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Strict TypeScript and Bun | PASS | All changes in TypeScript strict mode, Bun test runner only |
| II. Package Boundary Isolation | PASS | Changes confined to `apps/api/src/sandbox/`, shared type `SandboxConfig` in `packages/shared` is read-only (no schema change needed) |
| III. Channel Isolation | PASS | No cross-channel data access; sandbox env is per-instance |
| IV. Documentation Standards | PASS | New exported constants/functions will have JSDoc |
| V. Memory Engine Encapsulation | N/A | No memory operations involved |
| VI. Security by Default | PASS | This feature strengthens security: removes env spread, adds allowlist, validates token vars, fail-closed on invalid config |
| VII. Structured Observability | PASS | FR-010 requires LogTape warning on rejected `gitTokenEnvVar` |

**Gate result**: PASS — no violations.

## Project Structure

### Documentation (this feature)

```text
specs/20260406-201317-sandbox-env-allowlist/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
└── checklists/
    └── requirements.md  # Specification quality checklist
```

### Source Code (files to modify)

```text
apps/api/src/sandbox/
├── direct.ts                    # MODIFY: Replace ...Bun.env with allowlist, extract shared env builder
├── bubblewrap.ts                # MODIFY: Use shared env builder, validate gitTokenEnvVar
├── security.ts                  # MODIFY: Add gitTokenEnvVar validation + SAFE_ENV_VARS constant
├── __tests__/
│   ├── security.test.ts         # MODIFY: Add buildSandboxEnv and validateGitTokenEnvVar unit tests
│   ├── direct.test.ts           # MODIFY: Add env allowlist integration smoke test + gitTokenEnvVar tests
│   └── bubblewrap.test.ts       # MODIFY: Add gitTokenEnvVar tests, skipIf for bwrap integration
```

**Structure Decision**: No new files or directories needed. The shared allowlist constant and `gitTokenEnvVar` validation function belong in `security.ts` (existing security module). Both providers import from there.

## Post-Implementation Review Fixes

Issues found by `/pr-senior-review` after initial implementation:

### Issue 1 (High) — Bubblewrap PATH/HOME override

`buildSandboxEnv()` injects host `PATH` and `HOME` via the `--setenv` loop in `buildBwrapArgs()`, but bwrap already hardcodes `--setenv HOME /workspace` and `--setenv PATH /usr/local/sbin:...` above the loop. In bwrap, later `--setenv` calls override earlier ones, so the sandbox gets the **host's** PATH/HOME instead of the safe values.

**Fix**: Delete `HOME` and `PATH` from `mergedEnv` before the loop in `bubblewrap.ts:buildBwrapArgs()`.

### Issue 2 (High) — Orphaned temp directory on validation failure

`validateGitTokenEnvVar()` is called after `mkdir(workspacePath)` in both `DirectProvider.create()` and `BubblewrapProvider.create()`. If validation throws, the temp directory leaks.

**Fix**: Move `validateGitTokenEnvVar()` before `mkdir()` in both providers.

### Issue 5 (Medium) — Smoke test doesn't assert successful execution

The integration smoke test in `direct.test.ts` uses `not.toContain` assertions that would vacuously pass if the command was blocked (exitCode 1, empty stdout).

**Fix**: Add `expect(result.exitCode).toBe(0)` assertion.

### Issue 6 (Low) — Missing `await` on `rejects.toThrow`

Four test locations are missing `await` on `expect(...).rejects.toThrow(...)`, which can mask test failures.

**Fix**: Add `await` to all `rejects.toThrow` calls in `direct.test.ts` and `bubblewrap.test.ts`.

## PR Review Comment Fixes (Copilot + CodeRabbit)

Issues validated by `/pr-review-comments` after PR #21 submission:

### Issue R1 (Medium) — CLAUDE.md has wrong project structure, commands, and duplicate entry

Auto-generated `CLAUDE.md` shows `backend/ frontend/ tests/` but actual repo is `apps/api`, `apps/web`, `packages/*`. Commands show `npm test && npm run lint` but repo uses `bun run check`. Recent Changes section has duplicate bullet.

**Fix**: Update CLAUDE.md with correct structure, commands, and remove duplicate.

### Issue R2 (Medium) — Bubblewrap TMPDIR should be overridden to `/tmp`

`buildSandboxEnv()` passes host `TMPDIR` (e.g., `/var/folders/...`) into bwrap, but that path doesn't exist inside the bwrap namespace. Bwrap creates `--tmpfs /tmp` so `/tmp` is the correct sandbox temp path.

**Fix**: Override `mergedEnv.TMPDIR = '/tmp'` alongside the existing `HOME`/`PATH` deletions in `buildBwrapArgs()`.

### Issue R3 (Low) — bubblewrap.test.ts:72-94 GH_TOKEN mutation not in try/finally

Pre-existing test mutates `Bun.env.GH_TOKEN` without try/finally. If assertion throws, env stays polluted. Other new tests in this PR correctly use try/finally.

**Fix**: Wrap in try/finally matching the pattern used by other tests.

### Issue R4 (Low) — SC-004 parity test name is misleading

Test says "regardless of which provider calls it" but just tests determinism of two identical calls. The test is valid (same inputs = same outputs proves parity since both providers use the same function), but the name should reflect what it actually tests.

**Fix**: Rename to "produces deterministic output for identical inputs".

### Issue R5 (Low) — data-model.md HOME override wording

HOME override semantics differ between providers (Direct: `HOME=workspacePath`, Bubblewrap: `HOME=/workspace`). Doc simplifies this.

**Fix**: Clarify the composition order bullet to note provider-specific HOME behavior.

## CI Flake Fix (from main branch action run 24027854446)

The `DirectProvider > destroy removes workspace directory` test fails intermittently in CI with `Expected: true, Received: false` at line 158 — `existsSync(path)` returns false immediately after `provider.create()`. This is a pre-existing issue on `main` (not introduced by this PR).

**Root cause**: The test creates a sandbox without pushing it to the `sandboxes` array for cleanup. More importantly, `existsSync` is checking the workspace directory synchronously right after an async `mkdir` call — but since `mkdir` is awaited inside `create()`, this should work. The likely cause is test isolation: the `test-isolated.ts` runner spawns separate Bun processes per file, and under CI load the filesystem may not be flushed between the `mkdir` and `existsSync` calls.

**Fix**: Add a small defensive check — verify the `create()` call actually returns a sandbox with a valid path before asserting on `existsSync`. Additionally, ensure the test pushes to `sandboxes` for proper cleanup via `afterEach`.
