# Feature Specification: Sandbox Environment Variable Allowlist

**Feature Branch**: `20260406-201317-sandbox-env-allowlist`
**Created**: 2026-04-06
**Status**: Draft
**Input**: User description: "Address https://github.com/chrisleekr/personal-claw/issues/6"

## Clarifications

### Session 2026-04-06

- Q: Testing strategy for environment isolation — unit tests only, integration only, or hybrid? → A: Unit tests for env construction + one integration smoke test
- Q: How should Bubblewrap-specific tests run given bwrap is Linux-only? → A: Unit test arg construction everywhere; `describe.skipIf` bwrap integration tests on non-Linux
- Q: Should invalid `gitTokenEnvVar` throw an error or silently skip? → A: Throw an error — sandbox creation fails, caller must fix config
- Q: Should the environment allowlist be configurable or strictly hardcoded? → A: Strictly hardcoded — callers use `options.env` for anything beyond the allowlist

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Sandbox Prevents Host Secret Leakage (Priority: P1)

As a platform operator, I need sandboxed commands to only access a minimal set of safe environment variables so that host secrets (API keys, database credentials, cloud credentials) are never exposed to LLM-executed commands — even under prompt injection.

**Why this priority**: This is the core security vulnerability. An LLM instructed via prompt injection to run `env` or `printenv` would currently dump every secret on the host. Fixing the DirectSandbox environment spread is the highest-impact change.

**Independent Test**: Can be fully tested by unit testing the env object construction to verify only allowlisted keys are present, plus one integration smoke test executing `printenv` inside a DirectSandbox.

**Acceptance Scenarios**:

1. **Given** a DirectSandbox instance is created, **When** the sandboxed command runs `printenv`, **Then** only allowlisted environment variables (PATH, HOME, LANG, TERM, USER, SHELL, TMPDIR) and explicitly configured variables are present in the output
2. **Given** the host has DATABASE_URL, OPENAI_API_KEY, and AWS_SECRET_ACCESS_KEY set, **When** a sandboxed command runs `echo $DATABASE_URL`, **Then** the output is empty
3. **Given** a sandbox is created with custom `options.env` values, **When** the sandboxed command runs `printenv`, **Then** those custom values are present alongside the allowlisted variables
4. **Given** a sandbox is created with `envVars` configured by the provider, **When** the sandboxed command runs `printenv`, **Then** those provider-configured values are present alongside the allowlisted variables

---

### User Story 2 - Git Token Variable Validation (Priority: P2)

As a platform operator, I need the `gitTokenEnvVar` configuration to only accept known git token variable names so that an attacker cannot abuse it to read arbitrary host environment variables and inject them into the sandbox.

**Why this priority**: The `gitTokenEnvVar` is a secondary attack vector. If set to an arbitrary value like `DATABASE_URL`, it reads that host variable and injects it as `GH_TOKEN` / `GITHUB_TOKEN` into the sandbox. Restricting this to known token variable names closes this path.

**Independent Test**: Can be fully tested by attempting to create a sandbox with `gitTokenEnvVar` set to `DATABASE_URL` and verifying it throws an error.

**Acceptance Scenarios**:

1. **Given** `gitTokenEnvVar` is set to `GH_TOKEN`, **When** a sandbox is created, **Then** the sandbox is created successfully with the token value mapped
2. **Given** `gitTokenEnvVar` is set to `GITHUB_TOKEN`, **When** a sandbox is created, **Then** the sandbox is created successfully with the token value mapped
3. **Given** `gitTokenEnvVar` is set to `DATABASE_URL`, **When** a sandbox is created, **Then** creation throws an error indicating the variable name is not allowed
4. **Given** `gitTokenEnvVar` is set to an empty string or not configured, **When** a sandbox is created, **Then** the sandbox is created successfully without any git token mapping

---

### User Story 3 - Bubblewrap Sandbox Parity (Priority: P3)

As a platform operator, I need the BubblewrapSandbox to apply the same allowlist approach and `gitTokenEnvVar` validation as the DirectSandbox so that the security posture is consistent regardless of which sandbox provider is active.

**Why this priority**: While Bubblewrap provides stronger namespace isolation (Linux-only, requires kernel namespaces), the `gitTokenEnvVar` vulnerability exists in both providers. Consistent security policy across providers prevents confusion and ensures defense-in-depth.

**Independent Test**: Can be fully tested by unit testing `buildBwrapArgs` output on all platforms to verify only allowlisted env vars appear in `--setenv` arguments. Bwrap integration tests use `describe.skipIf(process.platform !== "linux")` since bwrap is Linux-only.

**Acceptance Scenarios**:

1. **Given** a BubblewrapSandbox is created, **When** the bwrap arguments are constructed, **Then** only allowlisted variables and explicitly configured variables appear in `--setenv` arguments
2. **Given** `gitTokenEnvVar` is set to `DATABASE_URL` for a Bubblewrap sandbox, **When** the sandbox is created, **Then** creation throws the same error as DirectSandbox
3. **Given** a BubblewrapSandbox and DirectSandbox are both created with the same configuration, **When** inspecting the environment variables available inside each, **Then** the set of variables is identical (excluding sandbox-specific paths)

---

### Edge Cases

- What happens when an allowlisted variable (e.g., PATH) is not set on the host? The variable should simply be absent from the sandbox environment — no error should occur.
- What happens when `options.env` contains a key that collides with the allowlist (e.g., `PATH`)? The explicitly provided value should override the allowlisted host value.
- What happens when `gitTokenEnvVar` points to a valid variable name but that variable is not set on the host? The sandbox should be created without git token mapping, matching current behavior.
- What happens when `envVars` from the provider contains a key that collides with the allowlist? The provider-configured value should override the allowlisted host value.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST replace the full host environment spread in DirectSandbox with an explicit allowlist of safe environment variables
- **FR-002**: The safe environment variable allowlist MUST be strictly hardcoded to: `PATH`, `HOME`, `LANG`, `TERM`, `USER`, `SHELL`, `TMPDIR` — not configurable per-channel or per-sandbox
- **FR-003**: System MUST allow explicitly configured variables (`envVars` from provider and `options.env` from callers) to be added to the sandbox environment, overriding allowlisted values if they collide
- **FR-004**: System MUST validate `gitTokenEnvVar` against a strict set of allowed token variable names before reading from the host environment
- **FR-005**: The allowed token variable names MUST be limited to: `GH_TOKEN`, `GITHUB_TOKEN`, `GIT_TOKEN`, `GITLAB_TOKEN`
- **FR-006**: System MUST throw an error and fail sandbox creation when `gitTokenEnvVar` is set to a disallowed variable name — fail-closed, no silent fallback
- **FR-007**: BubblewrapSandbox MUST apply the same `gitTokenEnvVar` validation as DirectSandbox
- **FR-008**: BubblewrapSandbox MUST only pass allowlisted and explicitly configured variables via `--setenv` arguments
- **FR-009**: System MUST include unit tests for env construction logic and one integration smoke test verifying sensitive environment variables are NOT present in the sandbox environment
- **FR-010**: System MUST log a warning when `gitTokenEnvVar` validation rejects a variable name, including the rejected name (but not its value)
- **FR-011**: Bubblewrap-specific integration tests MUST be conditionally skipped on non-Linux platforms using Bun's `describe.skipIf` API, since bwrap requires Linux kernel namespaces

### Key Entities

- **Environment Allowlist**: A strictly hardcoded set of host environment variable names considered safe to pass into sandboxed processes. These are operational variables (PATH, HOME, etc.) that commands need to function, not application secrets. Not configurable — callers use `options.env` for additional variables.
- **Git Token Variable Names**: A restricted set of environment variable names that `gitTokenEnvVar` is allowed to reference. These are well-known token variable names used by git hosting platforms.
- **Sandbox Environment**: The computed set of environment variables available inside a sandboxed process, composed from: allowlisted host variables, provider-configured variables, and caller-provided variables (in that precedence order, later overriding earlier).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Running `printenv` inside any sandbox type returns zero host secrets (API keys, database URLs, cloud credentials)
- **SC-002**: 100% of sandbox creation attempts with disallowed `gitTokenEnvVar` values throw an error and fail creation
- **SC-003**: All existing sandbox functionality continues to work correctly (commands execute, file operations succeed, git operations work with valid token configuration)
- **SC-004**: Both sandbox providers (Direct and Bubblewrap) produce identical environment variable sets for the same configuration inputs
- **SC-005**: Unit tests for env construction pass on all platforms (macOS and Linux); bwrap integration tests pass on Linux and skip gracefully on macOS

## Assumptions

- The allowlist of safe variables (`PATH`, `HOME`, `LANG`, `TERM`, `USER`, `SHELL`, `TMPDIR`) is sufficient for all commands that sandboxed processes need to execute. If specific commands require additional host variables, those should be passed explicitly via `options.env`.
- The set of allowed git token variable names (`GH_TOKEN`, `GITHUB_TOKEN`, `GIT_TOKEN`, `GITLAB_TOKEN`) covers all git hosting platforms the system needs to support. Additional platforms would require an update to this list.
- Existing callers that rely on arbitrary host environment variables leaking into the sandbox will need to explicitly pass required variables via `options.env` after this change.
- The BubblewrapSandbox already has stronger isolation via Linux namespaces, but this change ensures defense-in-depth by also restricting the environment variables it receives.
- Bubblewrap (bwrap) is a Linux-only tool requiring kernel namespaces, seccomp, and libcap — it cannot run on macOS.
