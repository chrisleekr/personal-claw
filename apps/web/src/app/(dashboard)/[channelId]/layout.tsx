'use client';

import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';

const tabs = [
  { label: 'Identity', segment: 'identity' },
  { label: 'Skills', segment: 'skills' },
  { label: 'MCP', segment: 'mcp' },
  { label: 'Memory', segment: 'memory' },
  { label: 'Conversations', segment: 'conversations' },
  { label: 'Schedules', segment: 'schedules' },
  { label: 'Approvals', segment: 'approvals' },
  { label: 'Settings', segment: 'settings' },
] as const;

export default function ChannelLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ channelId: string }>();
  const pathname = usePathname();

  const activeSegment = pathname.split('/').pop();

  return (
    <div>
      <nav className="mb-6 border-b border-border">
        <div className="flex gap-1 overflow-x-auto scrollbar-none">
          {tabs.map((tab) => {
            const isActive = activeSegment === tab.segment;
            return (
              <Link
                key={tab.segment}
                href={`/${params.channelId}/${tab.segment}`}
                className={`shrink-0 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
                  isActive
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30'
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>
      </nav>
      {children}
    </div>
  );
}
