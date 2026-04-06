# Quickstart: Sandbox Environment Variable Allowlist

**Date**: 2026-04-06
**Feature**: `20260406-201317-sandbox-env-allowlist`

## Overview

This security fix prevents host environment variables (API keys, database credentials, cloud secrets) from leaking into sandboxed processes. It replaces the full `...Bun.env` spread with a hardcoded allowlist and adds validation for `gitTokenEnvVar`.

## Changes at a Glance

| File | Change |
|------|--------|
| `apps/api/src/sandbox/security.ts` | Add `SAFE_ENV_VARS` constant, `ALLOWED_GIT_TOKEN_VARS` regex, `buildSandboxEnv()` and `validateGitTokenEnvVar()` functions |
| `apps/api/src/sandbox/direct.ts` | Replace `...Bun.env` spread with `buildSandboxEnv()` call; add `validateGitTokenEnvVar()` in `create()` |
| `apps/api/src/sandbox/bubblewrap.ts` | Use `buildSandboxEnv()` for `--setenv` args; add `validateGitTokenEnvVar()` in `create()` |
| `apps/api/src/sandbox/__tests__/direct.test.ts` | Add env allowlist unit tests + one integration smoke test |
| `apps/api/src/sandbox/__tests__/bubblewrap.test.ts` | Add env construction tests; wrap bwrap integration in `describe.skipIf` |

## Implementation Order

1. **Add shared security functions** in `security.ts` (no existing behavior changes)
2. **Update DirectProvider** to use allowlist and validate gitTokenEnvVar
3. **Update BubblewrapProvider** for parity
4. **Add tests** for both providers
5. **Run `bun run check`** to verify typecheck + lint + test pass

## Key Design Decisions

- **Allowlist is hardcoded** — not configurable. Callers use `options.env` for additional variables.
- **gitTokenEnvVar validation is fail-closed** — throws an error, does not silently skip.
- **Shared function** — `buildSandboxEnv()` is used by both providers to avoid duplication.
- **Bwrap tests skip on macOS** — uses `describe.skipIf(process.platform !== "linux")`.

## Breaking Changes

Sandboxed processes will no longer inherit arbitrary host environment variables. Any caller that relied on leaked host env vars must now pass them explicitly via `options.env`.
