import type { CLIToolDefinition } from '@personalclaw/shared';

type ValidationResult = { valid: true } | { valid: false; reason: string };

export function validateCommand(args: string, definition: CLIToolDefinition): ValidationResult {
  const trimmed = args.trim();

  if (trimmed.length === 0) {
    return { valid: false, reason: 'Empty command' };
  }

  if (/[;|&`$]|\$\(/.test(trimmed)) {
    return { valid: false, reason: 'Shell metacharacters are not allowed' };
  }

  for (const pattern of definition.deniedPatterns) {
    if (pattern.test(trimmed)) {
      return {
        valid: false,
        reason: `Command matches denied pattern: ${pattern.source}`,
      };
    }
  }

  const allowed = definition.allowedPatterns.some((pattern) => pattern.test(trimmed));
  if (!allowed) {
    return {
      valid: false,
      reason: `Command does not match any allowed pattern for ${definition.binary}`,
    };
  }

  return { valid: true };
}
