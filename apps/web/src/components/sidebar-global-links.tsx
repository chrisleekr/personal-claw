'use client';

import { DollarSign, Server } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const globalLinks = [
  { href: '/mcp', label: 'MCP Servers', icon: Server },
  { href: '/usage', label: 'Usage & Costs', icon: DollarSign },
] as const;

export function SidebarGlobalLinks() {
  const pathname = usePathname();

  return (
    <div className="space-y-1">
      {globalLinks.map((link) => {
        const isActive = pathname === link.href;
        const Icon = link.icon;
        return (
          <Link
            key={link.href}
            href={link.href}
            className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
              isActive
                ? 'bg-accent text-accent-foreground font-medium'
                : 'text-foreground/80 hover:bg-accent hover:text-accent-foreground'
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {link.label}
          </Link>
        );
      })}
    </div>
  );
}
