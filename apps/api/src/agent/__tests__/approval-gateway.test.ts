import { describe, expect, test } from 'bun:test';
import { globToRegex } from '../approval-gateway';

describe('globToRegex', () => {
  test('trailing wildcard matches prefix', () => {
    const re = globToRegex('newrelic__list*');
    expect(re.test('newrelic__list_dashboards')).toBe(true);
    expect(re.test('newrelic__list_alert_policies')).toBe(true);
    expect(re.test('newrelic__list_recent_issues')).toBe(true);
  });

  test('trailing wildcard does not match other prefixes', () => {
    const re = globToRegex('newrelic__list*');
    expect(re.test('newrelic__get_entity')).toBe(false);
    expect(re.test('newrelic__analyze_threads')).toBe(false);
    expect(re.test('slack__list_channels')).toBe(false);
  });

  test('server-level wildcard matches all tools from that server', () => {
    const re = globToRegex('newrelic__*');
    expect(re.test('newrelic__list_dashboards')).toBe(true);
    expect(re.test('newrelic__get_entity')).toBe(true);
    expect(re.test('newrelic__analyze_golden_metrics')).toBe(true);
    expect(re.test('newrelic__run_nrql_query')).toBe(true);
  });

  test('server-level wildcard does not match other servers', () => {
    const re = globToRegex('newrelic__*');
    expect(re.test('slack__post_message')).toBe(false);
    expect(re.test('github__create_issue')).toBe(false);
  });

  test('exact match (no wildcard) matches only that string', () => {
    const re = globToRegex('newrelic__run_nrql_query');
    expect(re.test('newrelic__run_nrql_query')).toBe(true);
    expect(re.test('newrelic__run_nrql_query_extra')).toBe(false);
    expect(re.test('newrelic__run_nrql')).toBe(false);
  });

  test('escapes regex special chars in tool names', () => {
    const re = globToRegex('server.name__tool*');
    expect(re.test('server.name__tool_foo')).toBe(true);
    expect(re.test('serverXname__tool_foo')).toBe(false);
  });

  test('multiple wildcards work', () => {
    const re = globToRegex('*__list*');
    expect(re.test('newrelic__list_dashboards')).toBe(true);
    expect(re.test('slack__list_channels')).toBe(true);
    expect(re.test('slack__post_message')).toBe(false);
  });
});

describe('pattern specificity', () => {
  test('more specific patterns have higher specificity', () => {
    const patterns = [
      { glob: 'newrelic__*', specificity: 'newrelic__*'.replace(/\*/g, '').length },
      { glob: 'newrelic__list*', specificity: 'newrelic__list*'.replace(/\*/g, '').length },
      { glob: '*__list*', specificity: '*__list*'.replace(/\*/g, '').length },
    ];

    patterns.sort((a, b) => b.specificity - a.specificity);

    expect(patterns[0].glob).toBe('newrelic__list*');
    expect(patterns[1].glob).toBe('newrelic__*');
    expect(patterns[2].glob).toBe('*__list*');
  });

  test('first matching pattern wins after specificity sort', () => {
    const policies = [
      { glob: 'newrelic__*', policy: 'ask' },
      { glob: 'newrelic__list*', policy: 'auto' },
    ];

    const entries = policies
      .map((p) => ({
        pattern: globToRegex(p.glob),
        specificity: p.glob.replace(/\*/g, '').length,
        policy: p.policy,
      }))
      .sort((a, b) => b.specificity - a.specificity);

    const toolName = 'newrelic__list_dashboards';
    const match = entries.find((e) => e.pattern.test(toolName));

    expect(match?.policy).toBe('auto');
  });

  test('catch-all applies when no specific pattern matches', () => {
    const policies = [
      { glob: 'newrelic__*', policy: 'ask' },
      { glob: 'newrelic__list*', policy: 'auto' },
    ];

    const entries = policies
      .map((p) => ({
        pattern: globToRegex(p.glob),
        specificity: p.glob.replace(/\*/g, '').length,
        policy: p.policy,
      }))
      .sort((a, b) => b.specificity - a.specificity);

    const toolName = 'newrelic__run_nrql_query';
    const match = entries.find((e) => e.pattern.test(toolName));

    expect(match?.policy).toBe('ask');
  });
});
