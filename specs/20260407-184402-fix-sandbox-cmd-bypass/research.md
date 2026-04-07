# Research: Fix Sandbox Command Allowlist Bypass

**Date**: 2026-04-07
**Feature**: 20260407-184402-fix-sandbox-cmd-bypass

## R1: Shell Metacharacter Pattern Gap — Newline Bypass

**Decision**: Add `\n`, `\r`, and `\0` to `SHELL_METACHAR_PATTERN` in `security.ts`.

**Rationale**: The current pattern `/[;|&`$]|\$\(/` does not block newline characters. Since both providers execute via `sh -c <command>`, an embedded newline causes the shell to execute multiple lines as separate commands. This is confirmed in the source: `bubblewrap.ts:222` uses `'sh', '-c', command` and `direct.ts:74` uses `['sh', '-c', command]`.

**Alternatives considered**:
- Splitting on newlines and validating each line independently — rejected: overly complex, allows multi-command execution which defeats the single-command design.
- Using `Bun.spawn` with `argv` array instead of `sh -c` — requires significant refactoring and breaks commands that rely on globbing/quoting.

## R2: Eval Flag Blocking — SUPERSEDED

**Original decision**: Block eval flags in the sandbox validator by reusing `hasEvalFlag` from mcp-security.ts.

**Superseded by**: "Sandbox is the boundary" philosophy. Eval flags (`-e`, `--eval`, `-c`, `-p`, `--print`) are now **allowed** inside the sandbox. The sandbox itself (bubblewrap namespace isolation, workspace restriction, timeout) is the primary security boundary. Blocking eval flags was security theater — `sandbox_write_file` + `node script.js` achieves the same result as `node -e "code"`.

**Final decision**: `hasEvalFlag` is NOT used by the sandbox command validator. It remains in `mcp-security.ts` for the MCP stdio transport validation, which has a stricter policy because it lacks sandbox isolation.

## R3: Per-Binary Dangerous Argument Rules

**Decision**: Implement a static map of `binaryName → Set<dangerousFlags>` in `security.ts` for commands like `find`, `git`, `pip`, and `curl`. The validator will reject commands where any argument matches the dangerous flags for that binary.

**Rationale**: Different binaries have different dangerous flags. A one-size-fits-all approach (like the metachar filter) can't catch `find -exec` or `git -c core.hooksPath`. The rules are:
- `find`: block `-exec`, `-execdir`, `-delete`, `-ok`, `-okdir`
- `git`: block `-c core.hooksPath`, `-c core.sshCommand`
- `pip`: block `install` without `--no-deps` or without exact version pinning (e.g., `package==1.0.0`)
- `curl`: block `-o`/`--output` targeting paths outside workspace

**Alternatives considered**:
- Using deniedPatterns regex for this — rejected: regex is fragile against flag reordering and whitespace variations. A structured approach is more reliable.

## R4: Robust deniedPatterns — Regex Upgrade

**Decision**: Replace literal string denied patterns with regex patterns that handle flag reordering. The default patterns become:
- `\brm\s+(-[a-z]*r[a-z]*\s+)*(-[a-z]*f[a-z]*\s+)*\/` — catches `rm -rf /`, `rm -r -f /`, `rm -fr /`, etc.
- `\bmkfs\b` — catches mkfs and variants
- `\bdd\b.*\bif=` — catches dd with if= in any position

**Rationale**: The current literal patterns are trivially bypassed. Issue #7 specifically calls out `rm -r -f /` and `rm -rf /*` as bypasses.

**Alternatives considered**:
- Semantic flag parsing (parse rm's arguments like the actual command would) — rejected: over-engineered for a defense-in-depth layer.

## R5: ReDoS Protection for User-Supplied Patterns

**Decision**: Use `safe-regex2` (or equivalent) to validate user-supplied deniedPattern strings before compiling them, plus a timeout wrapper for pattern execution. Reject patterns detected as vulnerable at config load time.

**Rationale**: The `deniedPatterns` field accepts arbitrary regex strings from channel config. A malicious or accidentally complex pattern could cause catastrophic backtracking, effectively DoS-ing the command validator.

**Alternatives considered**:
- Timeout-only approach (no upfront validation) — rejected: a timeout of, say, 100ms per pattern still blocks the event loop in Bun since regex is synchronous.
- Disallowing user-supplied patterns entirely — rejected: breaks existing admin customization capability.
- Using `re2` (Google's linear-time regex engine) — viable but adds a native dependency. `safe-regex2` is simpler and sufficient for validation.

## R6: Bubblewrap Network Isolation

**Decision**: Add `--unshare-net` to `buildBwrapArgs()` when `config.networkAccess === false`. This is a single line addition at `bubblewrap.ts:200`.

**Rationale**: `bwrap --unshare-net` creates a new network namespace with no interfaces. This is the standard bubblewrap mechanism for network isolation and is zero-configuration. The `networkAccess` config already exists but is never read in `buildBwrapArgs`.

**Alternatives considered**:
- Using iptables rules — rejected: requires root and is much more complex.
- For the DirectProvider (macOS): no OS-level network namespace support exists. This will be documented as a bubblewrap-only feature.

## R7: Workspace Size Enforcement

**Decision**: For bubblewrap, mount the workspace as a tmpfs with a size limit: `--tmpfs /workspace --size=<maxWorkspaceSizeMb>M`, then bind the actual workspace directory on top. For the DirectProvider, perform a size check before and after each `exec` call (best-effort).

**Rationale**: tmpfs size limits are kernel-enforced, require no polling, and fail writes cleanly with ENOSPC. This is the most reliable enforcement mechanism for bubblewrap.

**Alternatives considered**:
- Periodic polling with `du` — rejected: race condition between check and write; polling overhead.
- Linux quota system — rejected: requires filesystem quota support and additional setup.
- Overlayfs with size-limited tmpfs as upper layer — more complex, no clear benefit over direct tmpfs.

**Note**: The current workspace binding at `bubblewrap.ts:197-199` uses `--bind workspace /workspace`. To add tmpfs limits, the approach would be: bind the workspace to a temp location, then mount a size-limited tmpfs at `/workspace`, then copy initial contents. Alternative: just use `--tmpfs /workspace` with size limit and let the sandbox start empty (current behavior since workspaces start empty anyway).

## R8: Shell Interpreter Warning for Custom Allowlists

**Decision**: Add a warning log at config validation time when `allowedCommands` contains any known shell interpreter (`bash`, `sh`, `dash`, `zsh`, `csh`, `ksh`, `fish`). The warning is emitted via LogTape at `warn` level. The system does NOT block the config — it respects admin overrides.

**Rationale**: Admins may have legitimate reasons to include shells (e.g., running trusted scripts). A warning preserves flexibility while making the security tradeoff visible.

**Alternatives considered**:
- Hard-blocking shell interpreters even in custom configs — rejected: breaks admin flexibility.
- No warning at all — rejected: admins might not realize the security implication.
