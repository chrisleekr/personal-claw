'use client';

import type { ApprovalPolicy, ApprovalPolicyRecord } from '@personalclaw/shared';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api-client';

const POLICY_OPTIONS: { value: ApprovalPolicy; label: string; description: string }[] = [
  { value: 'auto', label: 'Auto-approve', description: 'Execute without asking' },
  { value: 'ask', label: 'Ask', description: 'Require user approval each time' },
  { value: 'deny', label: 'Deny', description: 'Block execution entirely' },
  { value: 'allowlist', label: 'Allowlist', description: 'Only allow specific users' },
];

const POLICY_BADGE_STYLES: Record<ApprovalPolicy, string> = {
  auto: 'bg-green-500/10 text-green-700 dark:text-green-400',
  ask: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400',
  deny: 'bg-red-500/10 text-red-700 dark:text-red-400',
  allowlist: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
};

export default function ApprovalsPage() {
  const params = useParams<{ channelId: string }>();
  const [policies, setPolicies] = useState<ApprovalPolicyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formToolName, setFormToolName] = useState('');
  const [formPolicy, setFormPolicy] = useState<ApprovalPolicy>('auto');
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; toolName: string } | null>(null);

  const fetchPolicies = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.approvals.list(params.channelId);
      setPolicies(res.data);
    } catch {
      console.error('Failed to fetch approval policies');
    } finally {
      setLoading(false);
    }
  }, [params.channelId]);

  useEffect(() => {
    fetchPolicies();
  }, [fetchPolicies]);

  const resetForm = () => {
    setFormToolName('');
    setFormPolicy('auto');
    setShowForm(false);
  };

  const handleOpenChange = (open: boolean) => {
    if (open) {
      setFormToolName('');
      setFormPolicy('auto');
    }
    setShowForm(open);
  };

  const handleSubmit = async () => {
    if (!formToolName.trim()) return;
    try {
      await api.approvals.create({
        channelId: params.channelId,
        toolName: formToolName.trim(),
        policy: formPolicy,
      });
      resetForm();
      fetchPolicies();
    } catch {
      console.error('Failed to create approval policy');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.approvals.delete(id);
      fetchPolicies();
    } catch {
      console.error('Failed to delete approval policy');
    }
  };

  const isGlob = (name: string) => name.includes('*');

  if (loading) {
    return <div className="text-muted-foreground">Loading...</div>;
  }

  const exactPolicies = policies.filter((p) => !isGlob(p.toolName));
  const patternPolicies = policies.filter((p) => isGlob(p.toolName));

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Approval Policies</h1>
          <p className="text-muted-foreground">
            Control which tools require approval, auto-approve, or are denied. Supports glob
            patterns (e.g.{' '}
            <code className="text-xs bg-muted px-1 py-0.5 rounded">newrelic__list*</code>).
          </p>
        </div>
        <Dialog open={showForm} onOpenChange={handleOpenChange}>
          <DialogTrigger asChild>
            <Button>Add Policy</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Approval Policy</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label htmlFor="policy-tool-name">Tool name or pattern</Label>
                <Input
                  id="policy-tool-name"
                  placeholder="e.g. newrelic__list* or slack__post_message"
                  value={formToolName}
                  onChange={(e) => setFormToolName(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Use <code className="bg-muted px-1 rounded">*</code> as a wildcard. More specific
                  patterns take priority over broader ones.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="policy-type">Policy</Label>
                <Select
                  value={formPolicy}
                  onValueChange={(v) => setFormPolicy(v as ApprovalPolicy)}
                >
                  <SelectTrigger id="policy-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {POLICY_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        <span className="font-medium">{opt.label}</span>
                        <span className="text-muted-foreground ml-2 text-xs">
                          {opt.description}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2 pt-2">
                <Button onClick={handleSubmit} disabled={!formToolName.trim()}>
                  Create
                </Button>
                <Button variant="outline" onClick={resetForm}>
                  Cancel
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {policies.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            No approval policies configured. Tools without a policy will ask for approval by
            default.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {patternPolicies.length > 0 && (
            <div>
              <h2 className="text-sm font-medium text-muted-foreground mb-3 uppercase tracking-wider">
                Pattern policies
              </h2>
              <div className="space-y-2">
                {patternPolicies.map((p) => (
                  <PolicyCard key={p.id} policy={p} onDelete={setDeleteTarget} />
                ))}
              </div>
            </div>
          )}
          {exactPolicies.length > 0 && (
            <div>
              <h2 className="text-sm font-medium text-muted-foreground mb-3 uppercase tracking-wider">
                Exact tool policies
              </h2>
              <div className="space-y-2">
                {exactPolicies.map((p) => (
                  <PolicyCard key={p.id} policy={p} onDelete={setDeleteTarget} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete Policy"
        description={`Are you sure you want to delete the policy for "${deleteTarget?.toolName}"? Tools matching this pattern will fall back to the default approval behavior.`}
        onConfirm={() => {
          if (deleteTarget) handleDelete(deleteTarget.id);
        }}
      />
    </div>
  );
}

function PolicyCard({
  policy,
  onDelete,
}: {
  policy: ApprovalPolicyRecord;
  onDelete: (target: { id: string; toolName: string }) => void;
}) {
  const isPattern = policy.toolName.includes('*');

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 flex-wrap">
            <code className="rounded bg-muted px-2 py-1 text-sm font-mono">{policy.toolName}</code>
            {isPattern && (
              <Badge variant="outline" className="text-xs">
                glob
              </Badge>
            )}
            <Badge className={POLICY_BADGE_STYLES[policy.policy]}>{policy.policy}</Badge>
            {policy.policy === 'allowlist' && policy.allowedUsers.length > 0 && (
              <span className="text-xs text-muted-foreground">
                Users: {policy.allowedUsers.join(', ')}
              </span>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onDelete({ id: policy.id, toolName: policy.toolName })}
            className="text-red-500 hover:text-red-700 hover:bg-red-500/10"
          >
            Delete
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
