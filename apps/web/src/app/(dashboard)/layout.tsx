import Link from 'next/link';
import { ChannelSidebar } from '@/components/channel-sidebar';
import { DashboardShell } from '@/components/dashboard-shell';
import { SidebarGlobalLinks } from '@/components/sidebar-global-links';
import { auth, signOut } from '@/lib/auth';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  const sidebar = (
    <>
      <div className="flex h-14 items-center border-b border-border px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="text-lg">PersonalClaw</span>
        </Link>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 overflow-y-auto p-4">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Channels
          </h3>
          <ChannelSidebar />
        </div>

        <div className="shrink-0 border-t border-border p-4">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Global
          </h3>
          <SidebarGlobalLinks />
        </div>
      </div>

      <div className="shrink-0 border-t border-border p-4">
        <div className="mb-2 truncate text-sm text-muted-foreground">{session?.user?.email}</div>
        <form
          action={async () => {
            'use server';
            await signOut({ redirectTo: '/login' });
          }}
        >
          <button
            type="submit"
            className="w-full rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            Sign out
          </button>
        </form>
      </div>
    </>
  );

  return <DashboardShell sidebar={sidebar}>{children}</DashboardShell>;
}
