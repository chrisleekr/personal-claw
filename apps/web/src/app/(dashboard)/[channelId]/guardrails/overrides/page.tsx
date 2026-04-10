'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
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
import { api, type DetectionOverride } from '@/lib/api-client';

/**
 * Per-channel detection override admin page (T071, FR-033).
 *
 * Lists existing overrides for the channel and provides a small form to add
 * new entries (allowlist_signature / block_phrase / trust_mcp_tool) and a
 * delete button on each row. The proxy injects `X-User-Id` from the
 * authenticated Next.js session, so the backend enforces `channelAdmins`
 * membership using the logged-in user's email.
 *
 * Before this page works end-to-end, the web user's email must be present
 * in `channels.channelAdmins` for the target channel. Without that, every
 * write returns 403 and the error message surfaces in the UI.
 */
export default function DetectionOverridesPage() {
  const params = useParams<{ channelId: string }>();
  const [overrides, setOverrides] = useState<DetectionOverride[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form state for creating a new override.
  const [newKind, setNewKind] = useState<'allowlist_signature' | 'block_phrase' | 'trust_mcp_tool'>(
    'allowlist_signature',
  );
  const [newTargetKey, setNewTargetKey] = useState('');
  const [newJustification, setNewJustification] = useState('');
  const [creating, setCreating] = useState(false);

  const fetchOverrides = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.detectionOverrides.list(params.channelId);
      setOverrides(res.data.overrides);
    } catch (err) {
      setMessage({
        type: 'error',
        text: `Failed to load overrides: ${(err as Error).message}`,
      });
    } finally {
      setLoading(false);
    }
  }, [params.channelId]);

  useEffect(() => {
    fetchOverrides();
  }, [fetchOverrides]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newTargetKey.trim().length < 3) {
      setMessage({ type: 'error', text: 'Target key must be at least 3 characters.' });
      return;
    }
    if (newJustification.trim().length < 10) {
      setMessage({ type: 'error', text: 'Justification must be at least 10 characters.' });
      return;
    }
    setCreating(true);
    setMessage(null);
    try {
      await api.detectionOverrides.create(params.channelId, {
        overrideKind: newKind,
        targetKey: newTargetKey.trim(),
        justification: newJustification.trim(),
      });
      setNewTargetKey('');
      setNewJustification('');
      setMessage({ type: 'success', text: 'Override created.' });
      await fetchOverrides();
    } catch (err) {
      setMessage({
        type: 'error',
        text: `Failed to create override: ${(err as Error).message}`,
      });
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    setMessage(null);
    try {
      await api.detectionOverrides.delete(params.channelId, id);
      setMessage({ type: 'success', text: 'Override deleted.' });
      await fetchOverrides();
    } catch (err) {
      setMessage({
        type: 'error',
        text: `Failed to delete override: ${(err as Error).message}`,
      });
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Detection Overrides</CardTitle>
          <CardDescription>
            Per-channel allowlists, block phrases, and MCP tool trust entries for the injection
            detection pipeline (FR-033). Changes take effect within one config cache refresh cycle.
            Writes require your session user to be listed in the channel admins array.
          </CardDescription>
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

          <form onSubmit={handleCreate} className="space-y-4 rounded-lg border p-4">
            <h3 className="text-sm font-semibold">Add a new override</h3>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="override-kind">Kind</Label>
                <Select value={newKind} onValueChange={(v) => setNewKind(v as typeof newKind)}>
                  <SelectTrigger id="override-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="allowlist_signature">
                      Allowlist signature — suppress a base corpus signature
                    </SelectItem>
                    <SelectItem value="block_phrase">
                      Block phrase — add a channel-specific trigger
                    </SelectItem>
                    <SelectItem value="trust_mcp_tool">
                      Trust MCP tool — move an MCP tool into Category 1 (trusted)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="override-target-key">Target key</Label>
                <Input
                  id="override-target-key"
                  value={newTargetKey}
                  onChange={(e) => setNewTargetKey(e.target.value)}
                  placeholder={
                    newKind === 'allowlist_signature'
                      ? 'corpus_v1_sig_042'
                      : newKind === 'block_phrase'
                        ? 'internal_codename_alpha'
                        : 'internal_mcp_database_read'
                  }
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="override-justification">Justification</Label>
              <Input
                id="override-justification"
                value={newJustification}
                onChange={(e) => setNewJustification(e.target.value)}
                placeholder="Explain why this override is needed (min 10 chars)"
              />
            </div>

            <Button type="submit" disabled={creating}>
              {creating ? 'Creating...' : 'Create override'}
            </Button>
          </form>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Existing overrides</h3>
            {loading ? (
              <div className="text-sm text-muted-foreground">Loading...</div>
            ) : overrides.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                No overrides configured for this channel yet.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="p-2 text-left font-medium">Kind</th>
                      <th className="p-2 text-left font-medium">Target</th>
                      <th className="p-2 text-left font-medium">Justification</th>
                      <th className="p-2 text-left font-medium">Added by</th>
                      <th className="p-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {overrides.map((o) => (
                      <tr key={o.id} className="border-t">
                        <td className="p-2 font-mono text-xs">{o.overrideKind}</td>
                        <td className="p-2 font-mono text-xs">{o.targetKey}</td>
                        <td className="p-2 text-xs">{o.justification}</td>
                        <td className="p-2 text-xs text-muted-foreground">{o.createdBy}</td>
                        <td className="p-2">
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => handleDelete(o.id)}
                          >
                            Delete
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
