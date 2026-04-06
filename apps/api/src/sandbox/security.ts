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

const SHELL_METACHAR_PATTERN = /[;|&`$]|\$\(/;

export class SandboxCommandValidator {
  private readonly allowedCommands: Set<string>;
  private readonly deniedPatterns: RegExp[];

  constructor(config: SandboxConfig) {
    this.allowedCommands = new Set(config.allowedCommands);
    this.deniedPatterns = config.deniedPatterns.map((p) => new RegExp(p));
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
          'Shell metacharacters (&&, ||, ;, |, $, `) are not allowed. ' +
          'Run one command per sandbox_exec call. ' +
          'For multi-step tasks, make separate sequential calls.',
      };
    }

    const binary = trimmed.split(/\s+/)[0];
    const baseBinary = binary.split('/').pop() ?? binary;

    if (!this.allowedCommands.has(baseBinary)) {
      const allowed = [...this.allowedCommands].sort().join(', ');
      return {
        valid: false,
        reason: `Command "${baseBinary}" is not in the allowed list. Allowed commands: ${allowed}`,
      };
    }

    for (const pattern of this.deniedPatterns) {
      if (pattern.test(trimmed)) {
        return {
          valid: false,
          reason: `Command matches denied pattern: ${pattern.source}`,
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
