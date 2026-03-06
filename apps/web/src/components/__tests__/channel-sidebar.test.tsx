import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

let mockPathname = '/';
const mockPush = mock(() => {});
const mockListChannels = mock(() =>
  Promise.resolve({
    data: [
      { id: 'ch-001', platform: 'slack' as const, externalId: 'C0123', externalName: '#general' },
      { id: 'ch-002', platform: 'cli' as const, externalId: 'local', externalName: null },
    ],
  }),
);
const mockCreateChannel = mock(() =>
  Promise.resolve({
    data: { id: 'ch-new', platform: 'slack', externalId: 'C999', externalName: null },
  }),
);

mock.module('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: mockPush }),
}));

mock.module('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    className?: string;
    title?: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

mock.module('../../lib/api-client', () => ({
  api: {
    channels: {
      list: mockListChannels,
      create: mockCreateChannel,
    },
  },
}));

import { ChannelSidebar } from '../channel-sidebar';

beforeEach(() => {
  mockPathname = '/';
  mockPush.mockClear();
  mockCreateChannel.mockClear();
  mockListChannels.mockReset();
  mockListChannels.mockImplementation(() =>
    Promise.resolve({
      data: [
        { id: 'ch-001', platform: 'slack' as const, externalId: 'C0123', externalName: '#general' },
        { id: 'ch-002', platform: 'cli' as const, externalId: 'local', externalName: null },
      ],
    }),
  );
});

afterEach(cleanup);

describe('ChannelSidebar', () => {
  test('shows loading skeleton initially', () => {
    mockListChannels.mockImplementation(() => new Promise(() => {}));
    render(<ChannelSidebar />);
    const skeletons = document.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBe(3);
  });

  test('renders channel list after loading', async () => {
    render(<ChannelSidebar />);
    await waitFor(() => {
      expect(screen.getByText('#general')).toBeDefined();
    });
    expect(screen.getByText('local')).toBeDefined();
  });

  test('renders "No channels configured" when list is empty', async () => {
    mockListChannels.mockImplementation(() => Promise.resolve({ data: [] }));
    render(<ChannelSidebar />);
    await waitFor(() => {
      expect(screen.getByText('No channels configured')).toBeDefined();
    });
  });

  test('highlights active channel based on pathname', async () => {
    mockPathname = '/ch-001/identity';
    render(<ChannelSidebar />);
    await waitFor(() => {
      expect(screen.getByText('#general')).toBeDefined();
    });
    const link = screen.getByText('#general').closest('a');
    expect(link?.className).toContain('font-medium');
  });

  test('renders New Channel button', async () => {
    render(<ChannelSidebar />);
    await waitFor(() => {
      expect(screen.getByText('New Channel')).toBeDefined();
    });
  });

  test('opens create dialog on New Channel click', async () => {
    render(<ChannelSidebar />);
    await waitFor(() => {
      expect(screen.getByText('New Channel')).toBeDefined();
    });
    fireEvent.click(screen.getByText('New Channel'));
    await waitFor(() => {
      expect(screen.getByText('Channel ID')).toBeDefined();
    });
  });

  test('handles fetch error gracefully', async () => {
    mockListChannels.mockImplementation(() => Promise.reject(new Error('Network error')));
    render(<ChannelSidebar />);
    await waitFor(() => {
      expect(screen.getByText('No channels configured')).toBeDefined();
    });
  });

  test('uses externalId as display name when externalName is null', async () => {
    render(<ChannelSidebar />);
    await waitFor(() => {
      expect(screen.getByText('local')).toBeDefined();
    });
  });
});
