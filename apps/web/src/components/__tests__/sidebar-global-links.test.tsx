import { afterEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, render, screen } from '@testing-library/react';

let mockPathname = '/';
mock.module('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: mock(() => {}) }),
}));

import { SidebarGlobalLinks } from '../sidebar-global-links';

afterEach(() => {
  cleanup();
  mockPathname = '/';
});

describe('SidebarGlobalLinks', () => {
  test('renders MCP Servers link', () => {
    render(<SidebarGlobalLinks />);
    expect(screen.getByText('MCP Servers')).toBeDefined();
  });

  test('renders Usage & Costs link', () => {
    render(<SidebarGlobalLinks />);
    expect(screen.getByText('Usage & Costs')).toBeDefined();
  });

  test('highlights active link based on pathname', () => {
    mockPathname = '/mcp';
    render(<SidebarGlobalLinks />);
    const link = screen.getByText('MCP Servers').closest('a');
    expect(link?.className).toContain('font-medium');
  });

  test('does not highlight inactive link', () => {
    mockPathname = '/usage';
    render(<SidebarGlobalLinks />);
    const mcpLink = screen.getByText('MCP Servers').closest('a');
    expect(mcpLink?.className).not.toContain('font-medium');
  });
});
