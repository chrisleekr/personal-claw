'use client';

import type { ChannelPlatform } from '@personalclaw/shared';
import { Hash, MessageSquare, Monitor, Plus, Terminal } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api-client';

const PLATFORM_ICONS: Record<ChannelPlatform, typeof MessageSquare> = {
  slack: MessageSquare,
  discord: Hash,
  teams: Monitor,
  cli: Terminal,
};

const PLATFORM_LABELS: Record<ChannelPlatform, string> = {
  slack: 'Slack',
  discord: 'Discord',
  teams: 'Teams',
  cli: 'CLI',
};

interface ChannelEntry {
  id: string;
  platform: ChannelPlatform;
  externalId: string;
  externalName: string | null;
}

export function ChannelSidebar() {
  const [channels, setChannels] = useState<ChannelEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [createPlatform, setCreatePlatform] = useState<ChannelPlatform>('slack');
  const [createExternalId, setCreateExternalId] = useState('');
  const [createName, setCreateName] = useState('');
  const [creating, setCreating] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  const fetchChannels = useCallback(() => {
    api.channels
      .list()
      .then((res: { data: ChannelEntry[] }) => setChannels(res.data))
      .catch(() => setChannels([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  const handleCreate = async () => {
    if (!createExternalId.trim()) return;
    setCreating(true);
    try {
      const res = await api.channels.create({
        platform: createPlatform,
        externalId: createExternalId.trim(),
        externalName: createName.trim() || undefined,
      });
      setShowCreate(false);
      setCreateExternalId('');
      setCreateName('');
      fetchChannels();
      router.push(`/${res.data.id}/identity`);
    } catch {
      /* error handled silently -- toast could be added */
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-2 px-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-8 animate-pulse rounded-md bg-muted" />
        ))}
      </div>
    );
  }

  return (
    <>
      <ScrollArea className="h-full">
        <div className="space-y-1">
          {channels.map((channel) => {
            const Icon = PLATFORM_ICONS[channel.platform];
            const isActive =
              pathname === `/${channel.id}` || pathname.startsWith(`/${channel.id}/`);
            const displayName = channel.externalName || channel.externalId;

            return (
              <Link
                key={channel.id}
                href={`/${channel.id}/identity`}
                className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
                  isActive
                    ? 'bg-accent text-accent-foreground font-medium'
                    : 'text-foreground/80 hover:bg-accent hover:text-accent-foreground'
                }`}
                title={`${PLATFORM_LABELS[channel.platform]}: ${displayName}`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{displayName}</span>
              </Link>
            );
          })}

          {channels.length === 0 && (
            <p className="px-2 py-1 text-sm text-muted-foreground">No channels configured</p>
          )}

          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <Plus className="h-4 w-4 shrink-0" />
            <span>New Channel</span>
          </button>
        </div>
      </ScrollArea>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Channel</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-platform">Platform</Label>
              <Select
                value={createPlatform}
                onValueChange={(v) => setCreatePlatform(v as ChannelPlatform)}
              >
                <SelectTrigger id="new-platform">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="slack">Slack</SelectItem>
                  <SelectItem value="discord">Discord</SelectItem>
                  <SelectItem value="teams">Teams</SelectItem>
                  <SelectItem value="cli">CLI</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-external-id">Channel ID</Label>
              <Input
                id="new-external-id"
                value={createExternalId}
                onChange={(e) => setCreateExternalId(e.target.value)}
                placeholder="C0123456789"
              />
              <p className="text-xs text-muted-foreground">
                The platform-specific channel identifier.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-name">Display Name (optional)</Label>
              <Input
                id="new-name"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="#general"
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleCreate} disabled={creating || !createExternalId.trim()}>
                {creating ? 'Creating...' : 'Create'}
              </Button>
              <Button variant="outline" onClick={() => setShowCreate(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
