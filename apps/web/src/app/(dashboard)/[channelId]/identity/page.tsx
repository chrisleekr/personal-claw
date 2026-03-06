'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { useConfigUpdates } from '@/hooks/use-config-updates';
import { api } from '@/lib/api-client';

export default function IdentityPage() {
  const params = useParams<{ channelId: string }>();
  const [identityPrompt, setIdentityPrompt] = useState('');
  const [teamPrompt, setTeamPrompt] = useState('');
  const [threadReplyMode, setThreadReplyMode] = useState('all');
  const [autonomyLevel, setAutonomyLevel] = useState('balanced');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchIdentity = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.identity.get(params.channelId);
      setIdentityPrompt(res.data.identityPrompt ?? '');
      setTeamPrompt(res.data.teamPrompt ?? '');
      setThreadReplyMode(res.data.threadReplyMode ?? 'all');
      setAutonomyLevel(res.data.autonomyLevel ?? 'balanced');
    } catch {
      setMessage({ type: 'error', text: 'Failed to load identity config.' });
    } finally {
      setLoading(false);
    }
  }, [params.channelId]);

  useEffect(() => {
    fetchIdentity();
  }, [fetchIdentity]);

  useConfigUpdates(params.channelId, () => {
    if (!saving) fetchIdentity();
  });

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await api.identity.update(params.channelId, {
        identityPrompt,
        teamPrompt,
        threadReplyMode,
        autonomyLevel,
      });
      setMessage({ type: 'success', text: 'Identity saved successfully.' });
    } catch {
      setMessage({ type: 'error', text: 'Failed to save identity.' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-muted-foreground">Loading...</div>;
  }

  return (
    <div>
      <Card>
        <CardHeader>
          <CardTitle>Identity &amp; Personality</CardTitle>
          <CardDescription>Configure the AI agent personality for this channel.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {message && (
            <div
              className={`rounded-lg px-4 py-3 text-sm ${
                message.type === 'success'
                  ? 'bg-green-500/10 text-green-700 dark:text-green-400'
                  : 'bg-red-500/10 text-red-700 dark:text-red-400'
              }`}
            >
              {message.text}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="identity-prompt">Identity Prompt</Label>
            <Textarea
              id="identity-prompt"
              placeholder="You are PersonalClaw, an AI assistant..."
              value={identityPrompt}
              onChange={(e) => setIdentityPrompt(e.target.value)}
              className="min-h-32"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="team-context">Team Context</Label>
            <Textarea
              id="team-context"
              placeholder="This team focuses on..."
              value={teamPrompt}
              onChange={(e) => setTeamPrompt(e.target.value)}
              className="min-h-32"
            />
          </div>

          <Separator />

          <div className="space-y-2">
            <Label htmlFor="thread-reply-mode">Thread Reply Mode</Label>
            <Select value={threadReplyMode} onValueChange={setThreadReplyMode}>
              <SelectTrigger id="thread-reply-mode" className="w-[280px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Reply to all messages</SelectItem>
                <SelectItem value="mentions_only">Only when @mentioned</SelectItem>
                <SelectItem value="original_poster">Only to thread starter</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Controls when the bot responds to thread messages. Direct @mentions always get a
              response regardless of this setting.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="autonomy-level">Autonomy Level</Label>
            <Select value={autonomyLevel} onValueChange={setAutonomyLevel}>
              <SelectTrigger id="autonomy-level" className="w-[280px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cautious">Cautious — always ask before acting</SelectItem>
                <SelectItem value="balanced">
                  Balanced — act when clear, ask when ambiguous
                </SelectItem>
                <SelectItem value="autonomous">
                  Autonomous — only confirm destructive actions
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Controls how much freedom the agent has to act without explicit plan approval.
            </p>
          </div>

          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
