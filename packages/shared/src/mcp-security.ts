/**
 * Security constants for MCP stdio transport validation.
 *
 * Defense-in-depth: these are used at both the Zod schema layer
 * (packages/shared) and the runtime layer (apps/api buildTransport).
 *
 * @see https://github.com/chrisleekr/personal-claw/issues/5
 */

/**
 * Binaries allowed as the `command` field for stdio MCP configs.
 *
 * `python` is intentionally excluded — it may resolve to Python 2 on
 * some systems, which is EOL and carries known vulnerabilities.
 * Users should explicitly use `python3`.
 */
export const ALLOWED_STDIO_COMMANDS: ReadonlySet<string> = Object.freeze(
  new Set(['npx', 'node', 'uvx', 'python3', 'deno', 'bun']),
);

/**
 * Environment variable keys that are never allowed in MCP stdio `env`.
 * Matched case-insensitively.
 */
export const BLOCKED_ENV_KEYS: ReadonlySet<string> = Object.freeze(
  new Set([
    'LD_PRELOAD',
    'LD_LIBRARY_PATH',
    'DYLD_INSERT_LIBRARIES',
    'DYLD_FRAMEWORK_PATH',
    'NODE_OPTIONS',
    'PYTHONPATH',
    'PYTHONSTARTUP',
    'PATH',
    'BASH_ENV',
    'ENV',
    'CDPATH',
  ]),
);

/** Maximum number of args for a stdio command. */
export const MAX_STDIO_ARGS_COUNT = 20;

/** Maximum length of a single arg string. */
export const MAX_STDIO_ARG_LENGTH = 1000;

/** Maximum length of the cwd path. */
export const MAX_STDIO_CWD_LENGTH = 500;

/**
 * Regex matching shell metacharacters that could allow injection when
 * passed as arguments to `child_process.spawn`.
 *
 * Covers: semicolons, pipes, ampersands, backticks, command substitution
 * ($(...) and ${...}), redirection operators, newlines, and null bytes.
 */
export const SHELL_METACHAR_PATTERN = /[;|&`<>]|\$\(|\$\{|[\n\r\0]/;

/**
 * Flags that allow inline code execution on allowed commands.
 * These must be blocked to prevent arbitrary code execution even
 * when the binary itself is in the allowlist.
 *
 * Covers: node -e, node --eval, node -p, node --print,
 *         python3 -c, deno eval (handled by arg check),
 *         bun -e, bun --eval.
 */
export const BLOCKED_EVAL_FLAGS: ReadonlySet<string> = Object.freeze(
  new Set(['-e', '--eval', '-p', '--print', '-c']),
);

/**
 * Short flags that accept their value concatenated without a space,
 * e.g. `-ecode` or `-p"expr"`, which bypass exact Set.has() matching.
 */
const SHORT_EVAL_FLAGS = ['-e', '-p', '-c'];

/**
 * Long flags that accept `=`-separated values,
 * e.g. `--eval=code` or `--print=expr`.
 */
const LONG_EVAL_FLAGS = ['--eval=', '--print='];

/**
 * Subcommands that allow inline code execution when used as a
 * positional argument (e.g. `deno eval "code"`).
 */
const EVAL_SUBCOMMANDS = ['eval'];

/**
 * Returns true when ANY arg matches a blocked eval/exec flag.
 *
 * Checks:
 * - Exact match: `-e`, `--eval`, `-p`, `--print`, `-c`
 * - Short-flag concatenation: `-ecode`, `-p"expr"`
 * - Long-flag=value: `--eval=code`, `--print=expr`
 * - Positional subcommands: `eval` (for `deno eval`)
 */
export function hasEvalFlag(args: string[]): boolean {
  return args.some((a) => {
    // Exact match (original check)
    if (BLOCKED_EVAL_FLAGS.has(a)) return true;

    // Short flag with concatenated value: -ecode, -p"expr"
    // Must be longer than the flag itself to distinguish from exact match
    if (SHORT_EVAL_FLAGS.some((flag) => a.startsWith(flag) && a.length > flag.length)) return true;

    // Long flag with =value: --eval=code, --print=expr
    if (LONG_EVAL_FLAGS.some((prefix) => a.startsWith(prefix))) return true;

    // Positional subcommand: "eval" (e.g. deno eval "code")
    if (EVAL_SUBCOMMANDS.includes(a)) return true;

    return false;
  });
}

/** Returns true when the command is in the allowlist. */
export function isAllowedStdioCommand(command: string): boolean {
  return ALLOWED_STDIO_COMMANDS.has(command);
}

/** Returns true when ANY env key matches the blocklist (case-insensitive). */
export function hasBlockedEnvKey(env: Record<string, string>): boolean {
  return Object.keys(env).some((k) => BLOCKED_ENV_KEYS.has(k.toUpperCase()));
}

/** Returns true when ANY arg contains shell metacharacters. */
export function hasShellMetachars(args: string[]): boolean {
  return args.some((a) => SHELL_METACHAR_PATTERN.test(a));
}

/** Returns true when the cwd contains path traversal segments. */
export function hasPathTraversal(cwd: string): boolean {
  return /(^|[\\/])\.\.($|[\\/])/.test(cwd);
}
