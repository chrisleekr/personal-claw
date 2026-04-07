# Implementation Plan: Fix Sandbox Command Allowlist Bypass

**Branch**: `20260407-184402-fix-sandbox-cmd-bypass` | **Date**: 2026-04-07 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/20260407-184402-fix-sandbox-cmd-bypass/spec.md`
**Reference**: [GitHub Issue #7](https://github.com/chrisleekr/personal-claw/issues/7)

## Summary

Fix 5 compounding security vulnerabilities in the sandbox layer: (1) remove `bash`/`sh` from default allowlist, (2) add newline/null byte to metacharacter filter, (3) block only genuinely destructive or stealth-attack argument patterns per binary, (4) upgrade deniedPatterns to robust regex with ReDoS protection, (5) enforce bubblewrap network isolation and workspace size limits.

**Design principle**: Give the agent maximum developer-like power. The sandbox (bubblewrap namespace isolation, workspace restriction, timeout) is the primary security boundary. Only block actions that are truly **destructive** (mass deletion, system binary overwrites) or **stealth attacks** (git hook overrides). Do NOT block productive tools like `node -e`, `python3 -c`, `find -exec`, or `pip install flask` — these are standard developer workflows and the sandbox itself limits their blast radius.

## Technical Context

**Language/Version**: TypeScript 5.7+ (strict mode, zero `any`)
**Primary Dependencies**: Bun 1.3.9 (runtime), Hono (API), LogTape (logging), Zod (validation), `@personalclaw/shared` (types, schemas, MCP security)
**Storage**: N/A (no database changes - config defaults change in code only)
**Testing**: Bun test runner (`bun test`)
**Target Platform**: Linux server (bubblewrap full isolation), macOS (direct provider, reduced isolation)
**Project Type**: Web service (agent engine backend)
**Performance Goals**: Command validation must add negligible latency (under 1ms per validation call)
**Constraints**: Zero new runtime dependencies preferred; `safe-regex2` is the only candidate addition (for ReDoS validation)
**Scale/Scope**: 4 source files modified, 4 test files modified, approximately 200-300 lines of new/changed code

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Strict TypeScript and Bun | PASS | All code in strict TS, Bun runtime, bun test |
| II. Package Boundary Isolation | PASS | Shared types/schemas stay in `packages/shared`; sandbox logic stays in `apps/api` |
| III. Channel Isolation | N/A | No database queries in this feature |
| IV. Documentation Standards | PASS | JSDoc added in same commit as implementation (not deferred to polish) |
| V. Memory Engine Encapsulation | N/A | No memory operations |
| VI. Security by Default | PASS | This feature directly strengthens security defaults (defense-in-depth, MCP security reuse) |
| VII. Structured Observability | PASS | All rejected commands logged via LogTape at appropriate levels |

**Post-Phase 1 re-check**: All gates still pass. No new dependencies on `pg`/`drizzle` in `apps/`. Shared types remain in `packages/shared`. LogTape used for all logging. JSDoc is co-located with implementation tasks per Principle IV.

## Project Structure

### Documentation (this feature)

```text
specs/20260407-184402-fix-sandbox-cmd-bypass/
├── plan.md
├── spec.md
├── research.md
├── data-model.md
├── quickstart.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
apps/api/src/sandbox/
├── security.ts              # Command validator - primary changes
├── bubblewrap.ts            # Bubblewrap provider - network + disk + rejection logging
├── direct.ts                # Direct provider - rejection logging
├── manager.ts               # Default config - allowlist + patterns
├── tools.ts                 # Sandbox tools - no changes
├── types.ts                 # Type definitions - no changes
└── __tests__/
    ├── security.test.ts     # Comprehensive bypass test suite
    ├── bubblewrap.test.ts   # Network isolation + size limit tests
    ├── direct.test.ts       # Updated test config
    ├── manager.test.ts      # Default config validation tests
    └── schemas.test.ts      # (in packages/shared) Updated default expectations

packages/shared/src/
├── schemas.ts               # Zod schema defaults + ReDoS validation
├── mcp-security.ts          # Not used by sandbox (stricter MCP-only policy)
├── types.ts                 # SandboxConfig interface - unchanged
└── __tests__/
    └── schemas.test.ts      # Updated default expectations
```

**Structure Decision**: Monorepo structure preserved. All changes within existing files at existing package boundaries. No new packages, modules, or directories created.

## Implementation Phases

### Phase 1: Command Validation Hardening (P1)

**Files**: `apps/api/src/sandbox/security.ts`, `apps/api/src/sandbox/manager.ts`, `packages/shared/src/schemas.ts`

1. **Update `SHELL_METACHAR_PATTERN`** in `security.ts:79`:
   - Add `\n`, `\r`, `\0` to the character class
   - Covers FR-010

2. **Add argument-level validation** in `security.ts`:
   - Add `DANGEROUS_ARG_RULES` static map — blocks only destructive/stealth actions
   - Extend `validateCommand()` to call `validateDangerousArgs()` after binary allowlist check
   - Rules (minimal, targeted):
     - `find`: block only `-delete` (destructive). Allow `-exec`/`-execdir` (productive).
     - `git`: block `-c core.hooksPath`/`-c core.sshCommand` (stealth attack).
     - `pip`: block `install` from URLs or absolute paths outside workspace. Allow normal PyPI installs.
     - `curl`: block `-o` to absolute paths outside workspace. Allow workspace-relative downloads.
   - **NOT blocked** (sandbox is the boundary): `node -e`, `python3 -c`, `bun -e`, `find -exec`
   - Covers FR-003, FR-004, FR-008, FR-015, FR-016

3. **Add shell interpreter detection** in `security.ts`:
   - Define `SHELL_INTERPRETERS` set: `bash`, `sh`, `dash`, `zsh`, `csh`, `ksh`, `fish`
   - If binary is in `SHELL_INTERPRETERS` AND in `allowedCommands`, emit LogTape warning
   - Still allow (admin override) but log the security risk
   - Covers FR-001 (warning path)

4. **Update default allowlist** in `manager.ts:20-44` and `schemas.ts:48-72`:
   - Remove: `bash`, `sh`
   - Add: `npx`, `bunx`, `sort`, `uniq`
   - Covers FR-005

5. **Upgrade default deniedPatterns** in `manager.ts:45` and `schemas.ts:73`:
   - Replace literal patterns with regex that catches flag reordering
   - Covers FR-011

6. **Add ReDoS validation** in `schemas.ts`:
   - Add a Zod `.refine()` on `deniedPatterns` that validates each pattern string
   - Use timeout-based validation as fallback
   - Covers FR-012

7. **Add rejected command logging** in `bubblewrap.ts` and `direct.ts`:
   - When `validateCommand()` returns invalid, emit `logger.warn('Command rejected', { sandboxId, command, reason })` before returning the error result
   - Covers FR-006, SC-005

8. **Add actionable error messages with alternatives** in `security.ts`:
   - Each rejection class includes a suggestion: e.g., "Use `find -name` to list files then remove specific files" instead of `find -delete`
   - Covers FR-007, SC-004

### Phase 2: Bubblewrap Network + Disk Enforcement (P2)

**File**: `apps/api/src/sandbox/bubblewrap.ts`

1. **Add `--unshare-net`** in `buildBwrapArgs()` around line 200:
   - Check `this.config.networkAccess === false`
   - If false, push `--unshare-net` to args array
   - Covers FR-013

2. **Add tmpfs size limit** in `buildBwrapArgs()`:
   - Add `--size` parameter to the tmpfs mount or add a workspace size check
   - Since workspaces start empty, tmpfs is sufficient
   - Covers FR-014

### Phase 3: Comprehensive Test Suite

**Files**: All `__tests__/` files

1. **security.test.ts** - add test groups:
   - Newline bypass: commands with `\n`, `\r`, `\0`
   - Eval flags allowed: verify `node -e`, `python3 -c`, `bun -e` all pass (sandbox is boundary)
   - Per-binary destructive args: `find -delete` blocked, `find -exec` allowed, `git -c core.hooksPath` blocked, `pip install flask` allowed, `pip install https://url` blocked, `curl -o /usr/bin/x` blocked
   - Shell interpreter warning: config with bash triggers warning (spy on logger)
   - Robust denied patterns: `rm -rf /`, `rm -r -f /`, `rm -rf /*`
   - ReDoS protection: malicious pattern rejected at schema validation
   - Rejected command logging: verify `logger.warn` called on rejection
   - Actionable error messages: verify rejection messages include suggestions

2. **bubblewrap.test.ts** - add:
   - `--unshare-net` present when `networkAccess: false`
   - `--unshare-net` absent when `networkAccess: true`
   - tmpfs size arg present with correct value

3. **direct.test.ts** + **schemas.test.ts** + **manager.test.ts** - update:
   - Remove `bash`/`sh` from test configs
   - Update default allowlist assertions
   - Add `manager.test.ts` tests for `DEFAULT_SANDBOX_CONFIG` validation

**Documentation Note (Constitution IV compliance)**: JSDoc is added in the same task as the implementation, not deferred. Each implementation task includes JSDoc for any new exported symbols.

## Complexity Tracking

No constitution violations. All changes fit within existing architecture.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Existing channels with bash/sh in custom config break | Low | Medium | Warning only, not blocking; admin override preserved |
| ReDoS validation rejects legitimate complex patterns | Low | Low | Use generous threshold; provide clear error message |
| tmpfs workspace size limit blocks legitimate large operations | Medium | Medium | Default 256MB is generous; admin can increase |
| pip install from URL allows malicious setup.py | Low | Medium | Only blocks URL/path installs; normal PyPI installs allowed since PyPI has its own security |
| Agent uses find -exec destructively | Low | Low | Sandbox limits blast radius; -delete is the only truly dangerous flag blocked |
