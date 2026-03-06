'use client';

import type { Schedule } from '@personalclaw/shared';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useConfigUpdates } from '@/hooks/use-config-updates';
import { api } from '@/lib/api-client';

function PromptText({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [isClamped, setIsClamped] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: text changes affect element dimensions requiring re-measurement
  useEffect(() => {
    const el = ref.current;
    if (el) {
      setIsClamped(el.scrollHeight > el.clientHeight + 1);
    }
  }, [text]);

  return (
    <div>
      <p
        ref={ref}
        className={`text-sm text-muted-foreground whitespace-pre-wrap ${!isExpanded ? 'line-clamp-3' : ''}`}
      >
        {text}
      </p>
      {isClamped && (
        <button
          type="button"
          className="text-xs text-primary hover:underline mt-1"
          onClick={() => setIsExpanded((prev) => !prev)}
        >
          {isExpanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

export default function SchedulesPage() {
  const params = useParams<{ channelId: string }>();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState('');
  const [formCron, setFormCron] = useState('');
  const [formPrompt, setFormPrompt] = useState('');
  const [formEnabled, setFormEnabled] = useState(true);
  const [formNotifyUsers, setFormNotifyUsers] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [editForm, setEditForm] = useState<{
    id: string;
    name: string;
    cronExpression: string;
    prompt: string;
    enabled: boolean;
    notifyUsers: string;
  } | null>(null);

  const fetchSchedules = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.schedules.list(params.channelId);
      setSchedules(res.data);
    } catch {
      console.error('Failed to fetch schedules');
    } finally {
      setLoading(false);
    }
  }, [params.channelId]);

  useEffect(() => {
    fetchSchedules();
  }, [fetchSchedules]);

  useConfigUpdates(params.channelId, (e) => {
    if (e.changeType === 'schedules') fetchSchedules();
  });

  const resetForm = () => {
    setFormName('');
    setFormCron('');
    setFormPrompt('');
    setFormEnabled(true);
    setFormNotifyUsers('');
    setShowForm(false);
  };

  const handleOpenChange = (open: boolean) => {
    if (open) {
      setFormName('');
      setFormCron('');
      setFormPrompt('');
      setFormEnabled(true);
      setFormNotifyUsers('');
    }
    setShowForm(open);
  };

  const parseNotifyUsers = (input: string): string[] =>
    input
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

  const handleSubmit = async () => {
    try {
      await api.schedules.create({
        channelId: params.channelId,
        name: formName,
        cronExpression: formCron,
        prompt: formPrompt,
        enabled: formEnabled,
        notifyUsers: parseNotifyUsers(formNotifyUsers),
      });
      resetForm();
      fetchSchedules();
    } catch {
      console.error('Failed to create schedule');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.schedules.delete(id);
      fetchSchedules();
    } catch {
      console.error('Failed to delete schedule');
    }
  };

  const handleToggleEnabled = async (id: string, enabled: boolean) => {
    const prev = schedules;
    setSchedules((s) => s.map((sc) => (sc.id === id ? { ...sc, enabled } : sc)));
    try {
      await api.schedules.update(id, { enabled });
    } catch {
      setSchedules(prev);
      console.error('Failed to toggle schedule');
    }
  };

  const openEditDialog = (schedule: Schedule) => {
    setEditForm({
      id: schedule.id,
      name: schedule.name,
      cronExpression: schedule.cronExpression,
      prompt: schedule.prompt,
      enabled: schedule.enabled,
      notifyUsers: schedule.notifyUsers.join(', '),
    });
  };

  const handleUpdate = async () => {
    if (!editForm) return;
    try {
      await api.schedules.update(editForm.id, {
        name: editForm.name,
        cronExpression: editForm.cronExpression,
        prompt: editForm.prompt,
        enabled: editForm.enabled,
        notifyUsers: parseNotifyUsers(editForm.notifyUsers),
      });
      setEditForm(null);
      fetchSchedules();
    } catch {
      console.error('Failed to update schedule');
    }
  };

  if (loading) {
    return <div className="text-muted-foreground">Loading...</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Schedules</h1>
          <p className="text-muted-foreground">
            Scheduled jobs and heartbeat monitoring for this channel.
          </p>
        </div>
        <Dialog open={showForm} onOpenChange={handleOpenChange}>
          <DialogTrigger asChild>
            <Button>Add Schedule</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Schedule</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 pt-2">
              <div className="space-y-2">
                <Label htmlFor="schedule-name">Schedule name</Label>
                <Input
                  id="schedule-name"
                  placeholder="Schedule name"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="schedule-cron">Cron expression</Label>
                <Input
                  id="schedule-cron"
                  placeholder="e.g., 0 9 * * 1-5"
                  value={formCron}
                  onChange={(e) => setFormCron(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Format: minute hour day-of-month month day-of-week
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="schedule-prompt">Prompt</Label>
                <Textarea
                  id="schedule-prompt"
                  placeholder="What should the agent do? (e.g., Check NewRelic for alerts and summarize)"
                  value={formPrompt}
                  onChange={(e) => setFormPrompt(e.target.value)}
                  className="min-h-20"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="schedule-notify">Notify users</Label>
                <Input
                  id="schedule-notify"
                  placeholder="e.g., U0123ABC, U0456DEF"
                  value={formNotifyUsers}
                  onChange={(e) => setFormNotifyUsers(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Comma-separated platform user IDs to @mention when posting results.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="schedule-enabled"
                  checked={formEnabled}
                  onCheckedChange={(checked) => setFormEnabled(checked === true)}
                />
                <Label htmlFor="schedule-enabled" className="text-sm font-normal">
                  Enabled
                </Label>
              </div>
              <div className="flex gap-2 pt-2">
                <Button onClick={handleSubmit}>Create</Button>
                <Button variant="outline" onClick={resetForm}>
                  Cancel
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {schedules.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            No schedules configured. Click &quot;Add Schedule&quot; to create one.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {schedules.map((schedule) => (
            <Card key={schedule.id}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      className="font-semibold hover:underline text-left"
                      onClick={() => openEditDialog(schedule)}
                    >
                      {schedule.name}
                    </button>
                    <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                      {schedule.cronExpression}
                    </code>
                    <div className="flex items-center gap-1.5">
                      <Switch
                        checked={schedule.enabled}
                        onCheckedChange={(checked) => handleToggleEnabled(schedule.id, checked)}
                        aria-label={`Toggle ${schedule.name}`}
                      />
                      <span
                        className={`text-xs ${schedule.enabled ? 'text-green-700 dark:text-green-400' : 'text-muted-foreground'}`}
                      >
                        {schedule.enabled ? 'Active' : 'Disabled'}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => openEditDialog(schedule)}
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleteTarget({ id: schedule.id, name: schedule.name })}
                      className="text-red-500 hover:text-red-700 hover:bg-red-500/10"
                    >
                      Delete
                    </Button>
                  </div>
                </div>
                <PromptText text={schedule.prompt} />
                {schedule.notifyUsers.length > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Notify: {schedule.notifyUsers.join(', ')}
                  </p>
                )}
                {schedule.lastRunAt && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Last run: {new Date(schedule.lastRunAt).toLocaleString()}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={editForm !== null}
        onOpenChange={(open) => {
          if (!open) setEditForm(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Schedule</DialogTitle>
          </DialogHeader>
          {editForm && (
            <div className="space-y-3 pt-2">
              <div className="space-y-2">
                <Label htmlFor="edit-name">Schedule name</Label>
                <Input
                  id="edit-name"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-cron">Cron expression</Label>
                <Input
                  id="edit-cron"
                  value={editForm.cronExpression}
                  onChange={(e) => setEditForm({ ...editForm, cronExpression: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Format: minute hour day-of-month month day-of-week
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-prompt">Prompt</Label>
                <Textarea
                  id="edit-prompt"
                  value={editForm.prompt}
                  onChange={(e) => setEditForm({ ...editForm, prompt: e.target.value })}
                  className="min-h-32"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-notify">Notify users</Label>
                <Input
                  id="edit-notify"
                  value={editForm.notifyUsers}
                  onChange={(e) => setEditForm({ ...editForm, notifyUsers: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Comma-separated platform user IDs to @mention when posting results.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="edit-enabled"
                  checked={editForm.enabled}
                  onCheckedChange={(checked) =>
                    setEditForm({ ...editForm, enabled: checked === true })
                  }
                />
                <Label htmlFor="edit-enabled" className="text-sm font-normal">
                  Enabled
                </Label>
              </div>
              <div className="flex gap-2 pt-2">
                <Button onClick={handleUpdate}>Save</Button>
                <Button variant="outline" onClick={() => setEditForm(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete Schedule"
        description={`Are you sure you want to delete "${deleteTarget?.name}"? This action cannot be undone.`}
        onConfirm={() => {
          if (deleteTarget) handleDelete(deleteTarget.id);
        }}
      />
    </div>
  );
}
