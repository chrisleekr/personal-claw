# Quickstart: Fix Sandbox Command Allowlist Bypass

**Date**: 2026-04-07
**Feature**: 20260407-184402-fix-sandbox-cmd-bypass

## Overview

This feature hardens the sandbox command execution layer by fixing 5 security vulnerabilities documented in [Issue #7](https://github.com/chrisleekr/personal-claw/issues/7). All changes are within `apps/api/src/sandbox/` and `packages/shared/src/`.

## Files to Modify

### Primary Changes

| File | Change |
|------|--------|
| `apps/api/src/sandbox/security.ts` | Add newline/null to metachar filter; add `validateCommandArgs()` with eval flag + per-binary dangerous arg checks; add shell interpreter warning |
| `apps/api/src/sandbox/manager.ts` | Update `DEFAULT_SANDBOX_CONFIG.allowedCommands` (remove `bash`/`sh`, add `npx`/`bunx`/`sort`/`uniq`); upgrade `deniedPatterns` to robust regex |
| `packages/shared/src/schemas.ts` | Update `sandboxConfigSchema` defaults to match manager.ts; add ReDoS validation for deniedPatterns |
| `apps/api/src/sandbox/bubblewrap.ts` | Add `--unshare-net` when `networkAccess: false`; add tmpfs size limit for workspace |

### Test Changes

| File | Change |
|------|--------|
| `apps/api/src/sandbox/__tests__/security.test.ts` | Add tests for: newline bypass, eval flags, per-binary arg rules, shell interpreter warnings, robust denied patterns, ReDoS rejection |
| `apps/api/src/sandbox/__tests__/bubblewrap.test.ts` | Add tests for: `--unshare-net` presence/absence, tmpfs size args |
| `apps/api/src/sandbox/__tests__/direct.test.ts` | Update test config to remove `bash`/`sh` from allowlist |
| `packages/shared/src/__tests__/schemas.test.ts` | Update expectations for new default allowlist |

### Relationship to MCP Security Module

The `hasEvalFlag()` function in `packages/shared/src/mcp-security.ts` is NOT used by the sandbox command validator. The MCP stdio transport has a stricter policy (no eval flags) because it lacks sandbox isolation. The sandbox validator intentionally allows eval flags because the sandbox itself (bubblewrap/direct) is the security boundary.

## Verification

```bash
bun run check
```

This runs typecheck, lint, and all tests. All existing tests must continue to pass (FR-009 backward compatibility). New tests must cover all bypass vectors documented in the spec.

## Key Design Decisions

1. **Shell interpreters removed from default allowlist** — not configurable, but admins can add them back via channel config (with logged warning).
2. **Eval flags allowed inside sandbox** — the sandbox is the security boundary, not eval flag blocking. `node -e`, `python3 -c`, `find -exec` are all productive developer tools.
3. **Per-binary arg rules block only destructive/stealth actions** — `find -delete`, `git -c core.hooksPath`, `pip install` from URLs, `curl -o` outside workspace. Everything else is allowed.
4. **Bubblewrap network isolation uses `--unshare-net`** — kernel-level, zero-config, no iptables needed.
5. **Workspace size enforcement uses tmpfs** — kernel-enforced, fails with ENOSPC, no polling.
6. **DirectProvider (macOS)** — gets command validation improvements but NOT network isolation or workspace size enforcement (no OS-level support).
