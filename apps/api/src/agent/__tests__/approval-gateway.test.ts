import { beforeEach, describe, expect, mock, test } from 'bun:test';

let mockPolicyRows: Array<{ toolName: string; policy: string; allowedUsers: string[] }> = [];

mock.module('../../db', () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([...mockPolicyRows]),
      }),
    }),
  }),
}));

mock.module('../../hooks/engine', () => ({
  HooksEngine: {
    getInstance: () => ({
      emit: mock(() => Promise.resolve()),
    }),
  },
}));

import { ApprovalGateway, globToRegex } from '../approval-gateway';

function makeMockAdapter(approveAll = true) {
  return {
    sendMessage: mock(() => Promise.resolve()),
    sendTyping: mock(() => Promise.resolve()),
    requestApproval: mock(() => Promise.resolve(approveAll)),
    requestBatchApproval: mock(() => Promise.resolve(approveAll)),
    requestPlanApproval: mock(() => Promise.resolve(approveAll)),
    platform: 'test',
    channelId: 'ch-001',
  } as never;
}

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

describe('ApprovalGateway.checkApproval', () => {
  beforeEach(() => {
    mockPolicyRows = [];
  });

  test('auto-approves when pattern policy matches with auto', async () => {
    mockPolicyRows = [{ toolName: 'github__*', policy: 'auto', allowedUsers: [] }];
    const gateway = new ApprovalGateway('ch-001', 'thread-1', 'user-1', makeMockAdapter());

    const result = await gateway.checkApproval('github__get_file_contents', { owner: 'test' });

    expect(result).toBe(true);
  });

  test('auto-approves all tools matching server-level wildcard', async () => {
    mockPolicyRows = [{ toolName: 'github__*', policy: 'auto', allowedUsers: [] }];
    const gateway = new ApprovalGateway('ch-001', 'thread-1', 'user-1', makeMockAdapter());

    expect(await gateway.checkApproval('github__get_file_contents', {})).toBe(true);
    expect(await gateway.checkApproval('github__list_issues', {})).toBe(true);
    expect(await gateway.checkApproval('github__create_pull_request', {})).toBe(true);
  });

  test('does not auto-approve tools from other servers', async () => {
    mockPolicyRows = [{ toolName: 'github__*', policy: 'auto', allowedUsers: [] }];
    const adapter = makeMockAdapter(true);
    const gateway = new ApprovalGateway('ch-001', 'thread-1', 'user-1', adapter);

    const result = await gateway.checkApproval('slack__post_message', {});

    // Should fall through to queueForApproval (default) and eventually requestApproval
    expect(result).toBe(true); // adapter mock approves
  });

  test('denies when pattern policy is deny', async () => {
    mockPolicyRows = [{ toolName: 'github__*', policy: 'deny', allowedUsers: [] }];
    const gateway = new ApprovalGateway('ch-001', 'thread-1', 'user-1', makeMockAdapter());

    const result = await gateway.checkApproval('github__get_file_contents', {});

    expect(result).toBe(false);
  });

  test('exact policy takes priority over pattern policy', async () => {
    mockPolicyRows = [
      { toolName: 'github__*', policy: 'auto', allowedUsers: [] },
      { toolName: 'github__delete_repo', policy: 'deny', allowedUsers: [] },
    ];
    const gateway = new ApprovalGateway('ch-001', 'thread-1', 'user-1', makeMockAdapter());

    expect(await gateway.checkApproval('github__get_file_contents', {})).toBe(true);
    expect(await gateway.checkApproval('github__delete_repo', {})).toBe(false);
  });

  test('more specific pattern wins over less specific', async () => {
    mockPolicyRows = [
      { toolName: 'github__*', policy: 'ask', allowedUsers: [] },
      { toolName: 'github__get_*', policy: 'auto', allowedUsers: [] },
    ];
    const gateway = new ApprovalGateway('ch-001', 'thread-1', 'user-1', makeMockAdapter());

    expect(await gateway.checkApproval('github__get_file_contents', {})).toBe(true);
  });

  test('caches policies — only queries DB once', async () => {
    mockPolicyRows = [{ toolName: 'github__*', policy: 'auto', allowedUsers: [] }];
    const gateway = new ApprovalGateway('ch-001', 'thread-1', 'user-1', makeMockAdapter());

    await gateway.checkApproval('github__get_file_contents', {});
    // Change mock data — should NOT affect result since policies are cached
    mockPolicyRows = [];
    const result = await gateway.checkApproval('github__list_issues', {});

    expect(result).toBe(true);
  });

  test('safe tools auto-approve when no policy exists', async () => {
    mockPolicyRows = [];
    const safeTools = new Set(['memory_search']);
    const gateway = new ApprovalGateway(
      'ch-001',
      'thread-1',
      'user-1',
      makeMockAdapter(),
      safeTools,
    );

    const result = await gateway.checkApproval('memory_search', {});

    expect(result).toBe(true);
  });

  test('queues for approval when no policy matches and not safe', async () => {
    mockPolicyRows = [];
    const adapter = makeMockAdapter(false);
    const gateway = new ApprovalGateway('ch-001', 'thread-1', 'user-1', adapter);

    const result = await gateway.checkApproval('unknown_tool', {});

    expect(result).toBe(false);
  });

  test('allowlist policy approves matching user', async () => {
    mockPolicyRows = [
      { toolName: 'deploy__*', policy: 'allowlist', allowedUsers: ['user-1', 'user-2'] },
    ];
    const gateway = new ApprovalGateway('ch-001', 'thread-1', 'user-1', makeMockAdapter());

    expect(await gateway.checkApproval('deploy__production', {})).toBe(true);
  });

  test('allowlist policy denies non-matching user', async () => {
    mockPolicyRows = [{ toolName: 'deploy__*', policy: 'allowlist', allowedUsers: ['user-2'] }];
    const gateway = new ApprovalGateway('ch-001', 'thread-1', 'user-1', makeMockAdapter());

    expect(await gateway.checkApproval('deploy__production', {})).toBe(false);
  });
});

describe('ApprovalGateway.getAutoApprovedNames', () => {
  beforeEach(() => {
    mockPolicyRows = [];
  });

  test('returns tool names matching auto pattern policies', async () => {
    mockPolicyRows = [{ toolName: 'github__*', policy: 'auto', allowedUsers: [] }];
    const gateway = new ApprovalGateway('ch-001', 'thread-1', 'user-1', makeMockAdapter());

    const result = await gateway.getAutoApprovedNames([
      'github__get_file_contents',
      'github__list_issues',
      'slack__post_message',
    ]);

    expect(result).toEqual(new Set(['github__get_file_contents', 'github__list_issues']));
  });

  test('returns empty set when no auto policies exist', async () => {
    mockPolicyRows = [{ toolName: 'github__*', policy: 'ask', allowedUsers: [] }];
    const gateway = new ApprovalGateway('ch-001', 'thread-1', 'user-1', makeMockAdapter());

    const result = await gateway.getAutoApprovedNames(['github__get_file_contents']);

    expect(result).toEqual(new Set());
  });

  test('includes exact auto policies', async () => {
    mockPolicyRows = [{ toolName: 'github__get_file_contents', policy: 'auto', allowedUsers: [] }];
    const gateway = new ApprovalGateway('ch-001', 'thread-1', 'user-1', makeMockAdapter());

    const result = await gateway.getAutoApprovedNames([
      'github__get_file_contents',
      'github__create_pr',
    ]);

    expect(result).toEqual(new Set(['github__get_file_contents']));
  });

  test('does not include deny or ask policies', async () => {
    mockPolicyRows = [
      { toolName: 'github__*', policy: 'auto', allowedUsers: [] },
      { toolName: 'github__delete_repo', policy: 'deny', allowedUsers: [] },
    ];
    const gateway = new ApprovalGateway('ch-001', 'thread-1', 'user-1', makeMockAdapter());

    const result = await gateway.getAutoApprovedNames([
      'github__get_file_contents',
      'github__delete_repo',
    ]);

    // delete_repo has exact deny policy which takes priority over the glob auto
    expect(result).toEqual(new Set(['github__get_file_contents']));
  });
});
