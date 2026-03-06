import type { CLIExecutionResult, CLIToolDefinition } from '@personalclaw/shared';

const MAX_OUTPUT_BYTES = 10_240;

function parseArgs(raw: string): string[] {
  const args: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (ch === ' ' && !inSingle && !inDouble) {
      if (current.length > 0) {
        args.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }

  if (current.length > 0) {
    args.push(current);
  }

  return args;
}

function truncate(text: string, maxBytes: number): string {
  if (text.length <= maxBytes) return text;
  return `${text.slice(0, maxBytes)}\n... [truncated at ${maxBytes} bytes]`;
}

export async function executeCLI(
  definition: CLIToolDefinition,
  rawArgs: string,
): Promise<CLIExecutionResult> {
  const args = parseArgs(rawArgs.trim());
  const cmd = [definition.binary, ...args];

  const env: Record<string, string | undefined> = {
    ...Bun.env,
    ...definition.env,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), definition.timeoutMs);

  try {
    const proc = Bun.spawn(cmd, {
      env,
      stdout: 'pipe',
      stderr: 'pipe',
      signal: controller.signal,
    });

    const [stdoutBuf, stderrBuf] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    const exitCode = await proc.exited;

    return {
      exitCode,
      stdout: truncate(stdoutBuf, MAX_OUTPUT_BYTES),
      stderr: truncate(stderrBuf, MAX_OUTPUT_BYTES),
    };
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      return {
        exitCode: 124,
        stdout: '',
        stderr: `Command timed out after ${definition.timeoutMs}ms`,
      };
    }
    return {
      exitCode: 1,
      stdout: '',
      stderr: (error as Error).message,
    };
  } finally {
    clearTimeout(timer);
  }
}
