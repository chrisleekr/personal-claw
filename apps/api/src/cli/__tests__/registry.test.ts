import { describe, expect, test } from 'bun:test';
import { CLI_REGISTRY } from '../registry';

describe('CLI_REGISTRY', () => {
  test('contains aws_cli, github_cli, and curl_fetch', () => {
    const names = CLI_REGISTRY.map((r) => r.name);
    expect(names).toContain('aws_cli');
    expect(names).toContain('github_cli');
    expect(names).toContain('curl_fetch');
  });

  test('each entry has required fields', () => {
    for (const def of CLI_REGISTRY) {
      expect(def.name).toBeDefined();
      expect(def.binary).toBeDefined();
      expect(def.description).toBeDefined();
      expect(def.allowedPatterns.length).toBeGreaterThan(0);
      expect(def.timeoutMs).toBeGreaterThan(0);
    }
  });

  test('aws_cli allows describe commands', () => {
    const aws = CLI_REGISTRY.find((r) => r.name === 'aws_cli');
    expect(aws).toBeDefined();
    const match = aws?.allowedPatterns.some((p) => p.test('ec2 describe-instances'));
    expect(match).toBe(true);
  });

  test('aws_cli denies destructive commands', () => {
    const aws = CLI_REGISTRY.find((r) => r.name === 'aws_cli');
    expect(aws).toBeDefined();
    const denied = aws?.deniedPatterns.some((p) => p.test('ec2 terminate-instances'));
    expect(denied).toBe(true);
  });

  test('github_cli has gh as binary', () => {
    const gh = CLI_REGISTRY.find((r) => r.name === 'github_cli');
    expect(gh).toBeDefined();
    expect(gh?.binary).toBe('gh');
  });

  test('curl_fetch has curl as binary', () => {
    const curl = CLI_REGISTRY.find((r) => r.name === 'curl_fetch');
    expect(curl).toBeDefined();
    expect(curl?.binary).toBe('curl');
  });
});
