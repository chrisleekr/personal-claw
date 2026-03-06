'use client';

import type { ChannelConfig } from '@personalclaw/shared';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { useConfigUpdates } from '@/hooks/use-config-updates';
import { api } from '@/lib/api-client';

export default function SettingsPage() {
  const params = useParams<{ channelId: string }>();
  const router = useRouter();
  const [channel, setChannel] = useState<ChannelConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [model, setModel] = useState('');
  const [provider, setProvider] = useState('anthropic');
  const [maxIterations, setMaxIterations] = useState(10);
  const [heartbeatEnabled, setHeartbeatEnabled] = useState(false);
  const [heartbeatCron, setHeartbeatCron] = useState('');
  const [heartbeatPrompt, setHeartbeatPrompt] = useState('');
  const [sandboxEnabled, setSandboxEnabled] = useState(true);
  const [browserEnabled, setBrowserEnabled] = useState(false);
  const [costBudgetDailyUsd, setCostBudgetDailyUsd] = useState('');
  const [promptInjectMode, setPromptInjectMode] = useState('every-turn');

  const fetchChannel = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.channels.get(params.channelId);
      const c = res.data;
      setChannel(c);
      setModel(c.model);
      setProvider(c.provider);
      setMaxIterations(c.maxIterations);
      setHeartbeatEnabled(c.heartbeatEnabled);
      setHeartbeatCron(c.heartbeatCron);
      setHeartbeatPrompt(c.heartbeatPrompt ?? '');
      setSandboxEnabled(c.sandboxEnabled);
      setBrowserEnabled(c.browserEnabled);
      setCostBudgetDailyUsd(c.costBudgetDailyUsd != null ? String(c.costBudgetDailyUsd) : '');
      setPromptInjectMode(c.promptInjectMode);
    } catch {
      setMessage({ type: 'error', text: 'Failed to load channel settings.' });
    } finally {
      setLoading(false);
    }
  }, [params.channelId]);

  useEffect(() => {
    fetchChannel();
  }, [fetchChannel]);

  useConfigUpdates(params.channelId, () => {
    if (!saving) fetchChannel();
  });

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const budget = costBudgetDailyUsd.trim();
      await api.channels.update(params.channelId, {
        model,
        provider,
        maxIterations,
        heartbeatEnabled,
        heartbeatCron,
        heartbeatPrompt: heartbeatPrompt || undefined,
        sandboxEnabled,
        browserEnabled,
        costBudgetDailyUsd: budget ? Number(budget) : null,
        promptInjectMode: promptInjectMode as 'every-turn' | 'once' | 'minimal',
      });
      setMessage({ type: 'success', text: 'Settings saved successfully.' });
    } catch {
      setMessage({ type: 'error', text: 'Failed to save settings.' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      await api.channels.delete(params.channelId);
      router.push('/');
    } catch {
      setMessage({ type: 'error', text: 'Failed to delete channel.' });
    }
  };

  if (loading) {
    return <div className="text-muted-foreground">Loading...</div>;
  }

  if (!channel) {
    return <div className="text-muted-foreground">Channel not found.</div>;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>LLM Configuration</CardTitle>
          <CardDescription>Configure the model and provider for this channel.</CardDescription>
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

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="model">Model</Label>
              <Input
                id="model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="claude-sonnet-4-20250514"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="provider">Provider</Label>
              <Select value={provider} onValueChange={setProvider}>
                <SelectTrigger id="provider">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="anthropic">Anthropic</SelectItem>
                  <SelectItem value="bedrock">AWS Bedrock</SelectItem>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="ollama">Ollama</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="max-iterations">Max Iterations</Label>
              <Input
                id="max-iterations"
                type="number"
                min={1}
                max={50}
                value={maxIterations}
                onChange={(e) => setMaxIterations(Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">
                Maximum tool-use steps per agent turn (1-50).
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="prompt-mode">Prompt Injection Mode</Label>
              <Select value={promptInjectMode} onValueChange={setPromptInjectMode}>
                <SelectTrigger id="prompt-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="every-turn">Every turn</SelectItem>
                  <SelectItem value="once">Once (first message only)</SelectItem>
                  <SelectItem value="minimal">Minimal (identity only)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Controls how much context is injected into each prompt.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Features</CardTitle>
          <CardDescription>Toggle agent capabilities for this channel.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>Sandbox Execution</Label>
              <p className="text-xs text-muted-foreground">
                Run tool commands in an isolated sandbox environment.
              </p>
            </div>
            <Switch checked={sandboxEnabled} onCheckedChange={setSandboxEnabled} />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div>
              <Label>Browser Automation</Label>
              <p className="text-xs text-muted-foreground">
                Enable Playwright-based browser tools (screenshots, scraping).
              </p>
            </div>
            <Switch checked={browserEnabled} onCheckedChange={setBrowserEnabled} />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div>
              <Label>Heartbeat</Label>
              <p className="text-xs text-muted-foreground">
                Periodically run a proactive monitoring check.
              </p>
            </div>
            <Switch checked={heartbeatEnabled} onCheckedChange={setHeartbeatEnabled} />
          </div>

          {heartbeatEnabled && (
            <div className="space-y-4 pl-4 border-l-2 border-muted">
              <div className="space-y-2">
                <Label htmlFor="heartbeat-cron">Cron Schedule</Label>
                <Input
                  id="heartbeat-cron"
                  value={heartbeatCron}
                  onChange={(e) => setHeartbeatCron(e.target.value)}
                  placeholder="*/30 * * * *"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="heartbeat-prompt">Heartbeat Prompt</Label>
                <Input
                  id="heartbeat-prompt"
                  value={heartbeatPrompt}
                  onChange={(e) => setHeartbeatPrompt(e.target.value)}
                  placeholder="Check monitoring tools for any alerts..."
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Budget</CardTitle>
          <CardDescription>Set a daily cost budget to prevent runaway spending.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 max-w-xs">
            <Label htmlFor="budget">Daily Budget (USD)</Label>
            <Input
              id="budget"
              type="number"
              min={0}
              step={0.01}
              value={costBudgetDailyUsd}
              onChange={(e) => setCostBudgetDailyUsd(e.target.value)}
              placeholder="No limit"
            />
            <p className="text-xs text-muted-foreground">
              Leave empty for unlimited. The agent will stop responding when the budget is exceeded.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save Settings'}
        </Button>
        <Button variant="destructive" onClick={() => setShowDeleteConfirm(true)}>
          Delete Channel
        </Button>
      </div>

      <ConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title="Delete Channel"
        description={`Are you sure you want to delete "${channel.externalName || channel.externalId}"? This will remove all skills, memories, schedules, and conversations associated with this channel. This action cannot be undone.`}
        onConfirm={handleDelete}
      />
    </div>
  );
}
