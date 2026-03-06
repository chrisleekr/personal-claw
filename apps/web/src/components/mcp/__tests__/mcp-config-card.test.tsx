import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { MCPConfig } from '@personalclaw/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MCPConfigCard } from '../mcp-config-card';

afterEach(cleanup);

const baseConfig: MCPConfig = {
  id: 'mcp-001',
  serverName: 'Test Server',
  transportType: 'sse',
  serverUrl: 'https://mcp.example.com/sse',
  headers: null,
  command: null,
  args: null,
  env: null,
  cwd: null,
  enabled: true,
  channelId: null,
};

describe('MCPConfigCard', () => {
  test('renders server name', () => {
    render(<MCPConfigCard config={baseConfig} onTest={mock(() => {})} />);
    expect(screen.getByText('Test Server')).toBeDefined();
  });

  test('shows Active badge when enabled', () => {
    render(<MCPConfigCard config={baseConfig} onTest={mock(() => {})} />);
    expect(screen.getByText('Active')).toBeDefined();
  });

  test('shows Disabled badge when not enabled', () => {
    render(<MCPConfigCard config={{ ...baseConfig, enabled: false }} onTest={mock(() => {})} />);
    expect(screen.getByText('Disabled')).toBeDefined();
  });

  test('shows transport type badge', () => {
    render(<MCPConfigCard config={baseConfig} onTest={mock(() => {})} />);
    expect(screen.getByText('sse')).toBeDefined();
  });

  test('renders Test button', () => {
    render(<MCPConfigCard config={baseConfig} onTest={mock(() => {})} />);
    expect(screen.getByText('Test')).toBeDefined();
  });

  test('calls onTest when Test button clicked', () => {
    const onTest = mock(() => {});
    render(<MCPConfigCard config={baseConfig} onTest={onTest} />);
    fireEvent.click(screen.getByText('Test'));
    expect(onTest).toHaveBeenCalledWith('mcp-001');
  });

  test('renders Edit button when onEdit provided', () => {
    render(<MCPConfigCard config={baseConfig} onTest={mock(() => {})} onEdit={mock(() => {})} />);
    expect(screen.getByText('Edit')).toBeDefined();
  });

  test('renders Delete button when onDelete provided', () => {
    render(<MCPConfigCard config={baseConfig} onTest={mock(() => {})} onDelete={mock(() => {})} />);
    expect(screen.getByText('Delete')).toBeDefined();
  });

  test('calls onDelete when Delete button clicked', () => {
    const onDelete = mock(() => {});
    render(<MCPConfigCard config={baseConfig} onTest={mock(() => {})} onDelete={onDelete} />);
    fireEvent.click(screen.getByText('Delete'));
    expect(onDelete).toHaveBeenCalledWith('mcp-001');
  });

  test('shows test result success', () => {
    const testResult = { loading: false, ok: true, toolCount: 5 };
    render(<MCPConfigCard config={baseConfig} onTest={mock(() => {})} testResult={testResult} />);
    expect(screen.getByText(/Connected/)).toBeDefined();
    expect(screen.getByText(/5 tools/)).toBeDefined();
  });

  test('shows test result failure', () => {
    const testResult = { loading: false, ok: false, error: 'Timeout' };
    render(<MCPConfigCard config={baseConfig} onTest={mock(() => {})} testResult={testResult} />);
    expect(screen.getByText(/Connection failed/)).toBeDefined();
    expect(screen.getByText(/Timeout/)).toBeDefined();
  });

  test('shows Testing... when loading', () => {
    const testResult = { loading: true };
    render(<MCPConfigCard config={baseConfig} onTest={mock(() => {})} testResult={testResult} />);
    expect(screen.getByText('Testing...')).toBeDefined();
  });

  test('shows headers count when headers present', () => {
    const config = { ...baseConfig, headers: { Authorization: 'Bearer token', 'X-Api': 'key' } };
    render(<MCPConfigCard config={config} onTest={mock(() => {})} />);
    expect(screen.getByText(/2 headers configured/)).toBeDefined();
  });

  test('displays config summary for SSE', () => {
    render(<MCPConfigCard config={baseConfig} onTest={mock(() => {})} />);
    expect(screen.getByText('https://mcp.example.com/sse')).toBeDefined();
  });
});
