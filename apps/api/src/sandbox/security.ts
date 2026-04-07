import { normalize, resolve } from 'node:path';
import { getLogger } from '@logtape/logtape';
import type { SandboxConfig } from '@personalclaw/shared';

const logger = getLogger(['personalclaw', 'sandbox', 'security']);

/**
 * Hardcoded set of host environment variable names safe to pass into sandboxed processes.
 * These are operational variables needed for basic command execution — not application secrets.
 * Not configurable; callers use `options.env` for additional variables.
 */
export const SAFE_ENV_VARS: readonly string[] = [
  'PATH',
  'HOME',
  'LANG',
  'TERM',
  'USER',
  'SHELL',
  'TMPDIR',
] as const;

/**
 * Regex matching the only environment variable names that `gitTokenEnvVar` is allowed to reference.
 * Restricts to well-known git hosting token variable names to prevent arbitrary host env var reads.
 */
export const ALLOWED_GIT_TOKEN_VARS = /^(GH_TOKEN|GITHUB_TOKEN|GIT_TOKEN|GITLAB_TOKEN)$/;

/**
 * Validates that `gitTokenEnvVar` references a known git token variable name.
 * Throws an error (fail-closed) for disallowed names. Accepts `null`, `undefined`, or empty string as no-op.
 * @param gitTokenEnvVar - The variable name from SandboxConfig to validate
 * @throws {Error} If the variable name is not in the allowed set
 */
export function validateGitTokenEnvVar(gitTokenEnvVar: string | null | undefined): void {
  if (!gitTokenEnvVar) return;

  if (!ALLOWED_GIT_TOKEN_VARS.test(gitTokenEnvVar)) {
    logger.warn('Rejected disallowed gitTokenEnvVar', { gitTokenEnvVar });
    throw new Error(
      `gitTokenEnvVar "${gitTokenEnvVar}" is not allowed. ` +
        'Must be one of: GH_TOKEN, GITHUB_TOKEN, GIT_TOKEN, GITLAB_TOKEN',
    );
  }
}

/**
 * Builds a sandbox environment by composing allowlisted host variables with explicitly configured variables.
 * Precedence (later overrides earlier): allowlisted host vars < provider envVars < caller options.env.
 * @param envVars - Provider-configured environment variables
 * @param optionsEnv - Caller-provided environment variables (from exec options)
 * @returns The composed environment record for the sandboxed process
 */
export function buildSandboxEnv(
  envVars?: Record<string, string>,
  optionsEnv?: Record<string, string>,
): Record<string, string> {
  const env: Record<string, string> = {};

  for (const key of SAFE_ENV_VARS) {
    const value = Bun.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }

  if (envVars) {
    Object.assign(env, envVars);
  }

  if (optionsEnv) {
    Object.assign(env, optionsEnv);
  }

  return env;
}

type ValidationResult = { valid: true } | { valid: false; reason: string };

const SHELL_METACHAR_PATTERN = /[;|&`$\n\r\0]|\$\(/;

/**
 * Known shell interpreters that defeat the command allowlist when included.
 * Any of these binaries can execute arbitrary commands via `-c` or script arguments,
 * rendering the allowlist meaningless. Removed from defaults; emits a warning if
 * an administrator re-adds them via custom config.
 */
export const SHELL_INTERPRETERS: ReadonlySet<string> = Object.freeze(
  new Set(['bash', 'sh', 'dash', 'zsh', 'csh', 'ksh', 'fish']),
);

/**
 * Per-binary rules that block only genuinely destructive or stealth-attack argument
 * patterns. The sandbox itself (bubblewrap namespace isolation, workspace restriction,
 * timeout) is the primary security boundary — these rules catch the narrow set of
 * actions that are destructive or bypass sandbox awareness.
 *
 * Design principle: give the agent maximum developer-like power; only block what's
 * truly destructive, not what's merely powerful.
 */
export const DANGEROUS_ARG_RULES: ReadonlyMap<
  string,
  { check: (args: string[]) => string | null }
> = new Map([
  [
    'find',
    {
      check: (args) => {
        // Only block -delete (destructive mass deletion). Allow -exec/-execdir
        // because the sandbox itself limits blast radius and the agent needs
        // these for legitimate developer workflows like find-and-replace.
        if (args.includes('-delete')) {
          return (
            '"find -delete" performs mass file deletion. ' +
            'Use "find -name ... -print" to list files, then remove specific files with "rm" instead.'
          );
        }
        return null;
      },
    },
  ],
  [
    'git',
    {
      check: (args) => {
        // Block hook overrides that execute code outside the sandbox's awareness.
        // These are stealth attack vectors, not legitimate developer workflows.
        for (let i = 0; i < args.length; i++) {
          const a = args[i];
          // Separate arg form: git -c core.hooksPath=...
          if (a === '-c' && i + 1 < args.length) {
            const val = args[i + 1];
            if (val && (val.startsWith('core.hooksPath') || val.startsWith('core.sshCommand'))) {
              return (
                `"git -c ${val}" can execute arbitrary code via hooks. ` +
                'Use standard git commands like clone, pull, push, status instead.'
              );
            }
          }
          // Concatenated form: git -ccore.hooksPath=...
          if (a.startsWith('-ccore.hooksPath') || a.startsWith('-ccore.sshCommand')) {
            return (
              `"git ${a}" can execute arbitrary code via hooks. ` +
              'Use standard git commands like clone, pull, push, status instead.'
            );
          }
        }
        return null;
      },
    },
  ],
  [
    'pip',
    {
      check: (args) => {
        if (args.length > 0 && args[0] === 'install') {
          // Block installs from URLs or absolute paths outside workspace —
          // these can serve malicious packages with arbitrary setup.py code.
          // Normal PyPI installs (pip install flask) are allowed — PyPI has
          // its own security and the sandbox limits blast radius.
          for (const a of args.slice(1)) {
            if (
              a.startsWith('http://') ||
              a.startsWith('https://') ||
              a.startsWith('ftp://') ||
              a.startsWith('git+') ||
              a.startsWith('svn+') ||
              a.startsWith('hg+') ||
              a.startsWith('bzr+')
            ) {
              return (
                '"pip install" from a URL can execute arbitrary code from untrusted sources. ' +
                'Use "pip install <package-name>" to install from PyPI instead.'
              );
            }
            if (a.startsWith('/') && !a.startsWith('/workspace')) {
              return (
                '"pip install" from a path outside the workspace is not allowed. ' +
                'Use "pip install ./" or "pip install <package-name>" from PyPI instead.'
              );
            }
          }
        }
        return null;
      },
    },
  ],
  [
    'curl',
    {
      check: (args) => {
        // Block -o/--output to absolute paths outside workspace.
        // Downloading to workspace or stdout is fine — the agent needs
        // curl for API calls and downloading dependencies.
        for (let i = 0; i < args.length; i++) {
          const a = args[i];
          if (a === '-o' || a === '--output') {
            const target = args[i + 1] ?? '';
            if (target.startsWith('/') && !target.startsWith('/workspace')) {
              return (
                `"curl -o ${target}" writes outside the workspace. ` +
                'Use "curl" without -o to print to stdout, or use -o with a workspace-relative path.'
              );
            }
          }
          if (a.startsWith('-o/') && !a.startsWith('-o/workspace')) {
            return (
              `"curl ${a}" writes outside the workspace. ` +
              'Use "curl" without -o or target a workspace-relative path.'
            );
          }
          // Equals-separated form: --output=/usr/bin/payload
          if (a.startsWith('--output=')) {
            const target = a.slice('--output='.length);
            if (target.startsWith('/') && !target.startsWith('/workspace')) {
              return (
                `"curl ${a}" writes outside the workspace. ` +
                'Use "curl" without --output or target a workspace-relative path.'
              );
            }
          }
        }
        return null;
      },
    },
  ],
]);

export class SandboxCommandValidator {
  private readonly allowedCommands: Set<string>;
  private readonly deniedPatterns: RegExp[];

  constructor(config: SandboxConfig) {
    this.allowedCommands = new Set(config.allowedCommands);
    this.deniedPatterns = config.deniedPatterns.map((p) => new RegExp(p));

    // Warn if shell interpreters are in the allowlist (admin override)
    for (const cmd of config.allowedCommands) {
      if (SHELL_INTERPRETERS.has(cmd)) {
        logger.warn(
          `Shell interpreter "${cmd}" is in allowedCommands. ` +
            'This defeats the command allowlist — any command can be run via ' +
            `"${cmd} -c <command>". Remove it unless you have a specific need.`,
        );
      }
    }
  }

  validateCommand(command: string): ValidationResult {
    const trimmed = command.trim();

    if (trimmed.length === 0) {
      return { valid: false, reason: 'Empty command' };
    }

    if (SHELL_METACHAR_PATTERN.test(trimmed)) {
      return {
        valid: false,
        reason:
          'Shell metacharacters (;, |, &, $, `, newlines) are not allowed. ' +
          'Run one command per sandbox_exec call. ' +
          'For multi-step tasks, make separate sequential calls.',
      };
    }

    const parts = trimmed.split(/\s+/);
    const binary = parts[0];
    const baseBinary = binary.split('/').pop() ?? binary;
    const args = parts.slice(1);

    if (!this.allowedCommands.has(baseBinary)) {
      const allowed = [...this.allowedCommands].sort().join(', ');
      return {
        valid: false,
        reason: `Command "${baseBinary}" is not in the allowed list. Allowed commands: ${allowed}`,
      };
    }

    // Check per-binary dangerous argument rules (destructive/stealth actions only)
    const argRule = DANGEROUS_ARG_RULES.get(baseBinary);
    if (argRule) {
      const rejection = argRule.check(args);
      if (rejection) {
        return { valid: false, reason: rejection };
      }
    }

    for (const pattern of this.deniedPatterns) {
      if (pattern.test(trimmed)) {
        return {
          valid: false,
          reason: `Command matches denied pattern: ${pattern.source}. Try a safer alternative.`,
        };
      }
    }

    return { valid: true };
  }
}

/**
 * Validates that a file path stays within the sandbox workspace.
 * Prevents directory traversal attacks (e.g. ../../etc/passwd).
 */
export function validateSandboxPath(relativePath: string, workspacePath: string): ValidationResult {
  if (relativePath.length === 0) {
    return { valid: false, reason: 'Empty path' };
  }

  const normalized = normalize(relativePath);

  if (normalized.startsWith('/')) {
    return { valid: false, reason: 'Absolute paths are not allowed' };
  }

  if (normalized.startsWith('..')) {
    return { valid: false, reason: 'Path traversal is not allowed' };
  }

  const resolved = resolve(workspacePath, normalized);
  if (!resolved.startsWith(workspacePath)) {
    return { valid: false, reason: 'Path escapes workspace boundary' };
  }

  return { valid: true };
}
