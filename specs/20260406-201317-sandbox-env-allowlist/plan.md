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
