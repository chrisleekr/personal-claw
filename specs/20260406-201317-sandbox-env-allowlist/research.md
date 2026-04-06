# Research: Sandbox Environment Variable Allowlist

**Date**: 2026-04-06
**Feature**: `20260406-201317-sandbox-env-allowlist`

## Research Tasks

### R1: Minimal safe environment variables for shell command execution

**Decision**: Allowlist `PATH`, `HOME`, `LANG`, `TERM`, `USER`, `SHELL`, `TMPDIR`

**Rationale**: These are the minimum variables needed for standard shell command execution:
- `PATH`: Required for command resolution
- `HOME`: Required by many tools as default working directory and config location (overridden to workspace path in sandbox)
- `LANG`: Locale setting — prevents encoding errors in command output
- `TERM`: Terminal type — needed by tools that check terminal capabilities
- `USER`: Current user identity — used by git and other tools
- `SHELL`: Default shell — referenced by tools that spawn subshells
- `TMPDIR`: Temporary directory location — used by build tools and compilers

**Alternatives considered**:
- Including `EDITOR`, `VISUAL`, `TZ` — rejected as unnecessary for automated sandbox commands
- Including `XDG_*` directories — rejected as too broad; sandbox has its own workspace
- Empty environment (no allowlist) — rejected because `PATH` is essential and missing `LANG` causes encoding issues

### R2: Shared env construction pattern for both providers

**Decision**: Extract a `buildSandboxEnv()` function into `security.ts` that both providers call

**Rationale**: Both `DirectProvider.create()` and `BubblewrapProvider.create()` have identical `gitTokenEnvVar` handling code (lines 215-221 in direct.ts, lines 267-273 in bubblewrap.ts). Extracting to a shared function:
- Eliminates duplication
- Ensures both providers apply identical validation
- Makes the env construction unit-testable without spawning processes

**Alternatives considered**:
- Base class with shared method — rejected because providers are simple factory classes, inheritance adds unnecessary complexity
- Inline in each provider — rejected because it duplicates the gitTokenEnvVar validation logic

### R3: gitTokenEnvVar validation approach

**Decision**: Validate against a regex pattern `/^(GH_TOKEN|GITHUB_TOKEN|GIT_TOKEN|GITLAB_TOKEN)$/` and throw an `Error` on mismatch

**Rationale**:
- Regex is simple, readable, and fast
- Throwing an error (fail-closed) aligns with Constitution Principle VI and the clarification decision
- The error message includes the rejected variable name but not its value (FR-010)
- LogTape warning is emitted before throwing for observability

**Alternatives considered**:
- Set/array lookup — functionally equivalent but regex is more concise for this small set
- Zod enum validation on `SandboxConfig` — rejected because it would require a schema change in `packages/shared` and a database migration; the validation belongs at the sandbox creation boundary, not the config schema level

### R4: Testing strategy for env construction

**Decision**: Unit test the `buildSandboxEnv()` function directly; one integration smoke test in `direct.test.ts`

**Rationale**:
- `buildSandboxEnv()` is a pure function (takes config + host env snapshot, returns env object) — ideal for unit testing
- Integration smoke test in DirectSandbox confirms end-to-end by running `printenv` and checking output
- Bubblewrap arg construction tests validate `--setenv` args without spawning bwrap
- Bwrap integration tests wrapped in `describe.skipIf(process.platform !== "linux")` per Bun docs

**Alternatives considered**:
- Integration-only testing — rejected as slow, fragile, and platform-dependent
- Mocking `Bun.spawn` — rejected due to known `mock.module` leakage issues in Bun (bun#12823)

### R5: Environment variable precedence order

**Decision**: Allowlisted host vars < provider `envVars` < caller `options.env` (later overrides earlier)

**Rationale**: This matches the existing precedence in the current code (`...Bun.env, ...this.envVars, ...options.env`) but scoped to only allowlisted host vars. The `HOME` override to `workspacePath` is applied last by the provider.

**Alternatives considered**:
- Caller `options.env` as lowest priority — rejected because callers need the ability to override for specific use cases
- No override allowed — rejected as too restrictive; breaks legitimate use of `options.env`
