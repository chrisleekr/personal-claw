import type { MCPConfig } from '@personalclaw/shared';

export function configSummary(config: MCPConfig): string {
  if (config.transportType === 'stdio') {
    const parts = [config.command, ...(config.args ?? [])];
    return parts.join(' ');
  }
  return config.serverUrl ?? '';
}

export function parseArgs(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed.map(String);
  } catch {
    /* not JSON, split by newline */
  }
  return trimmed
    .split(/\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseKeyValue(raw: string): Record<string, string> | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const result: Record<string, string> = {};
  for (const line of trimmed.split('\n')) {
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    const value = line.slice(eqIdx + 1).trim();
    if (key) result[key] = value;
  }
  return Object.keys(result).length > 0 ? result : null;
}
