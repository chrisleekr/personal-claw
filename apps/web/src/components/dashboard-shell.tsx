'use client';

import { Menu, X } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

export function DashboardShell({
  sidebar,
  children,
}: {
  sidebar: React.ReactNode;
  children: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();

  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname triggers sidebar close on route change
  useEffect(() => {
    closeSidebar();
  }, [pathname, closeSidebar]);

  useEffect(() => {
    if (!sidebarOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSidebar();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [sidebarOpen, closeSidebar]);

  return (
    <div className="flex h-screen">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={closeSidebar}
          aria-hidden
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-border bg-card transition-transform duration-200 ease-in-out md:static md:z-auto md:shrink-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        {/* Mobile close button */}
        <div className="absolute right-2 top-3 md:hidden">
          <Button variant="ghost" size="icon" onClick={closeSidebar} aria-label="Close sidebar">
            <X className="h-5 w-5" />
          </Button>
        </div>
        {sidebar}
      </aside>

      {/* Main content */}
      <main className="flex min-w-0 flex-1 flex-col overflow-auto bg-background">
        <div className="sticky top-0 z-30 flex h-12 items-center border-b border-border bg-background px-4 md:hidden">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open sidebar"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <span className="ml-2 text-sm font-semibold">PersonalClaw</span>
        </div>
        <div className="mx-auto w-full max-w-5xl p-6">{children}</div>
      </main>
    </div>
  );
}
