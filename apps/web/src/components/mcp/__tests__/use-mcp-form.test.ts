import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { MCPConfig } from '@personalclaw/shared';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useMCPForm } from '../use-mcp-form';

afterEach(cleanup);

const MOCK_CONFIG: MCPConfig = {
  id: 'mcp-001',
  serverName: 'Test Server',
  transportType: 'sse',
  serverUrl: 'https://mcp.example.com/sse',
  headers: { Authorization: 'Bearer tok' },
  command: null,
  args: null,
  env: null,
  cwd: null,
  enabled: true,
  channelId: null,
};

const STDIO_CONFIG: MCPConfig = {
  id: 'mcp-002',
  serverName: 'Stdio Server',
  transportType: 'stdio',
  serverUrl: null,
  headers: null,
  command: 'npx',
  args: ['-y', '@mcp/server'],
  env: { API_KEY: 'sk-123' },
  cwd: '/tmp',
  enabled: false,
  channelId: null,
};

function createMockOpts(overrides: Partial<Parameters<typeof useMCPForm>[0]> = {}) {
  return {
    fetchConfigs: mock(() => Promise.resolve([MOCK_CONFIG])),
    apiCreate: mock(() => Promise.resolve({})),
    apiUpdate: mock(() => Promise.resolve({})),
    apiDelete: mock(() => Promise.resolve({})),
    apiTest: mock(() => Promise.resolve({ data: { ok: true, toolCount: 5 } })),
    ...overrides,
  };
}

describe('useMCPForm', () => {
  test('loads configs on mount', async () => {
    const opts = createMockOpts();
    const { result } = renderHook(() => useMCPForm(opts));

    await act(async () => {});
    expect(opts.fetchConfigs).toHaveBeenCalled();
    expect(result.current.configs).toHaveLength(1);
    expect(result.current.loading).toBe(false);
  });

  test('handles fetch error gracefully', async () => {
    const opts = createMockOpts({
      fetchConfigs: mock(() => Promise.reject(new Error('fail'))),
    });
    const { result } = renderHook(() => useMCPForm(opts));

    await act(async () => {});
    expect(result.current.configs).toHaveLength(0);
    expect(result.current.loading).toBe(false);
  });

  test('setField updates form state', async () => {
    const opts = createMockOpts();
    const { result } = renderHook(() => useMCPForm(opts));
    await act(async () => {});

    act(() => result.current.setField('name', 'new-name'));
    expect(result.current.form.name).toBe('new-name');
  });

  test('isStdio reflects transport type', async () => {
    const opts = createMockOpts();
    const { result } = renderHook(() => useMCPForm(opts));
    await act(async () => {});

    expect(result.current.isStdio).toBe(false);

    act(() => result.current.setField('transport', 'stdio'));
    expect(result.current.isStdio).toBe(true);
  });

  test('handleEdit populates form from SSE config', async () => {
    const opts = createMockOpts();
    const { result } = renderHook(() => useMCPForm(opts));
    await act(async () => {});

    act(() => result.current.handleEdit(MOCK_CONFIG));
    expect(result.current.form.name).toBe('Test Server');
    expect(result.current.form.transport).toBe('sse');
    expect(result.current.form.url).toBe('https://mcp.example.com/sse');
    expect(result.current.form.headers).toBe('Authorization=Bearer tok');
    expect(result.current.showForm).toBe(true);
    expect(result.current.editingConfig).not.toBeNull();
  });

  test('handleEdit populates form from stdio config', async () => {
    const opts = createMockOpts();
    const { result } = renderHook(() => useMCPForm(opts));
    await act(async () => {});

    act(() => result.current.handleEdit(STDIO_CONFIG));
    expect(result.current.form.name).toBe('Stdio Server');
    expect(result.current.form.transport).toBe('stdio');
    expect(result.current.form.command).toBe('npx');
    expect(result.current.form.args).toBe('-y\n@mcp/server');
    expect(result.current.form.env).toBe('API_KEY=sk-123');
    expect(result.current.form.cwd).toBe('/tmp');
  });

  test('resetForm clears form and hides dialog', async () => {
    const opts = createMockOpts();
    const { result } = renderHook(() => useMCPForm(opts));
    await act(async () => {});

    act(() => result.current.handleEdit(MOCK_CONFIG));
    expect(result.current.showForm).toBe(true);

    act(() => result.current.resetForm());
    expect(result.current.form.name).toBe('');
    expect(result.current.showForm).toBe(false);
    expect(result.current.editingConfig).toBeNull();
  });

  test('handleSubmit creates new config for SSE', async () => {
    const opts = createMockOpts();
    const { result } = renderHook(() => useMCPForm(opts));
    await act(async () => {});

    act(() => {
      result.current.setField('name', 'New Server');
      result.current.setField('url', 'https://new.example.com');
    });

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(opts.apiCreate).toHaveBeenCalled();
    const payload = (opts.apiCreate as ReturnType<typeof mock>).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload.serverName).toBe('New Server');
    expect(payload.serverUrl).toBe('https://new.example.com');
    expect(payload.command).toBeNull();
  });

  test('handleSubmit creates new config for stdio', async () => {
    const opts = createMockOpts();
    const { result } = renderHook(() => useMCPForm(opts));
    await act(async () => {});

    act(() => {
      result.current.setField('name', 'Stdio');
      result.current.setField('transport', 'stdio');
      result.current.setField('command', 'node');
      result.current.setField('args', 'server.js\n--port\n3000');
      result.current.setField('env', 'KEY=val');
    });

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(opts.apiCreate).toHaveBeenCalled();
    const payload = (opts.apiCreate as ReturnType<typeof mock>).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload.command).toBe('node');
    expect(payload.args).toEqual(['server.js', '--port', '3000']);
    expect(payload.env).toEqual({ KEY: 'val' });
    expect(payload.serverUrl).toBeNull();
  });

  test('handleSubmit calls apiUpdate when editing', async () => {
    const opts = createMockOpts();
    const { result } = renderHook(() => useMCPForm(opts));
    await act(async () => {});

    act(() => result.current.handleEdit(MOCK_CONFIG));
    act(() => result.current.setField('name', 'Updated'));

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(opts.apiUpdate).toHaveBeenCalled();
    expect(opts.apiCreate).not.toHaveBeenCalled();
  });

  test('handleSubmit applies buildPayload if provided', async () => {
    const buildPayload = mock((base: Record<string, unknown>) => ({
      ...base,
      channelId: 'ch-001',
    }));
    const opts = createMockOpts({ buildPayload });
    const { result } = renderHook(() => useMCPForm(opts));
    await act(async () => {});

    act(() => result.current.setField('name', 'Test'));

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(buildPayload).toHaveBeenCalled();
    const payload = (opts.apiCreate as ReturnType<typeof mock>).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload.channelId).toBe('ch-001');
  });

  test('handleDelete calls apiDelete and reloads', async () => {
    const opts = createMockOpts();
    const { result } = renderHook(() => useMCPForm(opts));
    await act(async () => {});

    await act(async () => {
      await result.current.handleDelete('mcp-001');
    });

    expect(opts.apiDelete).toHaveBeenCalledWith('mcp-001');
    expect((opts.fetchConfigs as ReturnType<typeof mock>).mock.calls.length).toBeGreaterThan(1);
  });

  test('handleTest sets success result', async () => {
    const opts = createMockOpts();
    const { result } = renderHook(() => useMCPForm(opts));
    await act(async () => {});

    await act(async () => {
      await result.current.handleTest('mcp-001');
    });

    expect(result.current.testResults['mcp-001']).toEqual({
      loading: false,
      ok: true,
      toolCount: 5,
    });
  });

  test('handleTest sets failure result on error', async () => {
    const opts = createMockOpts({
      apiTest: mock(() => Promise.reject(new Error('Connection refused'))),
    });
    const { result } = renderHook(() => useMCPForm(opts));
    await act(async () => {});

    await act(async () => {
      await result.current.handleTest('mcp-001');
    });

    expect(result.current.testResults['mcp-001'].loading).toBe(false);
    expect(result.current.testResults['mcp-001'].ok).toBe(false);
    expect(result.current.testResults['mcp-001'].error).toBe('Connection refused');
  });

  test('refetch reloads configs', async () => {
    const opts = createMockOpts();
    const { result } = renderHook(() => useMCPForm(opts));
    await act(async () => {});

    const initialCallCount = (opts.fetchConfigs as ReturnType<typeof mock>).mock.calls.length;

    await act(async () => {
      await result.current.refetch();
    });

    expect((opts.fetchConfigs as ReturnType<typeof mock>).mock.calls.length).toBe(
      initialCallCount + 1,
    );
  });
});
