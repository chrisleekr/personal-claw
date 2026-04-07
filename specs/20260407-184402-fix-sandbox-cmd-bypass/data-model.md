# Data Model: Fix Sandbox Command Allowlist Bypass

**Date**: 2026-04-07
**Feature**: 20260407-184402-fix-sandbox-cmd-bypass

## Entities

### SandboxConfig (existing — modified)

The `SandboxConfig` interface in `packages/shared/src/types.ts` is unchanged structurally but its default values change:

| Field | Type | Change |
|-------|------|--------|
| `allowedCommands` | `string[]` | Default removes `bash`, `sh`; adds `npx`, `bunx`, `sort`, `uniq` |
| `deniedPatterns` | `string[]` | Default patterns upgraded to robust regex strings |
| `maxExecutionTimeS` | `number` | No change |
| `maxWorkspaceSizeMb` | `number` | No change (now enforced at runtime) |
| `networkAccess` | `boolean` | No change (now enforced at runtime for bubblewrap) |
| `gitTokenEnvVar` | `string \| null` | No change |

### DangerousArgRules (new — internal constant)

A static map defining per-binary argument restrictions. Only blocks destructive or stealth-attack patterns. Not persisted or user-configurable.

Design principle: the sandbox is the security boundary. Only block what's truly destructive, not what's merely powerful.

| Binary | Blocked Arguments | Reason |
|--------|-------------------|--------|
| `find` | `-delete` | Destructive mass file deletion |
| `git` | `-c core.hooksPath=*`, `-c core.sshCommand=*` | Stealth code execution via hooks |
| `pip` | `install` from URLs or absolute paths outside workspace | Untrusted source code execution |
| `curl` | `-o`/`--output` to absolute paths outside workspace | System binary overwrite |

**Explicitly allowed** (sandbox provides isolation):

| Binary | Allowed Arguments | Reason |
|--------|-------------------|--------|
| `node`, `python3`, `bun`, `deno` | `-e`, `--eval`, `-c`, `-p`, `--print` | Sandbox is the boundary; write-file + run-script achieves the same |
| `find` | `-exec`, `-execdir` | Productive developer workflow; sandbox limits blast radius |
| `pip` | `install <package>` (from PyPI) | Standard developer workflow; PyPI has its own security |

### ValidationResult (existing — unchanged)

```typescript
type ValidationResult = { valid: true } | { valid: false; reason: string };
```

## State Transitions

No new state machines. The `SandboxCommandValidator` remains stateless — it validates each command independently.

## Database Changes

**None.** All changes are in application code and configuration defaults. The `SandboxConfig` stored in channel database records does not change schema — only the Zod schema defaults and the hardcoded `DEFAULT_SANDBOX_CONFIG` change.

Existing channel configs with custom `allowedCommands` that include `bash`/`sh` will continue to work but trigger a warning log.
