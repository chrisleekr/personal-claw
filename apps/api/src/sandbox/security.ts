import { normalize, resolve } from 'node:path';
import type { SandboxConfig } from '@personalclaw/shared';

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
