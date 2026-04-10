'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { api, type DetectionAuditEvent } from '@/lib/api-client';

/**
 * Per-channel recent-blocks admin page (T080, FR-015).
 *
 * Lists the recent detection decisions for this channel (filtered to
 * non-allow actions by default), with optional drill-down to a single
 * audit event by reference id and an annotation workflow.
 *
 * T081 adds repeat-offender grouping: any `external_user_id` with more
 * than 5 block or flag decisions in a rolling 24-hour window is flagged
 * in the header summary, and the matching rows in the table are visually
 * highlighted.
 *
 * Auth model: reads and annotations go through the proxy which injects
 * `X-User-Id: session.user.email`. The user must be in the channel's
 * `channelAdmins` list for the backend to allow the request.
 */

/** How many blocks/flags in a 24-hour window constitute a "repeat offender". */
const REPEAT_OFFENDER_THRESHOLD = 5;
/** Rolling window for the offender grouping. */
const REPEAT_OFFENDER_WINDOW_MS = 24 * 60 * 60 * 1000;

type DecisionFilter = 'all' | 'block' | 'flag' | 'neutralize' | 'allow';

export default function RecentBlocksPage() {
  const params = useParams<{ channelId: string }>();
  const [events, setEvents] = useState<DetectionAuditEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Filter state — defaults to showing all decisions except 'allow' so the
  // admin sees actionable items first. The user can flip to 'allow' to
  // see the above-threshold allows too.
  const [decisionFilter, setDecisionFilter] = useState<DecisionFilter>('block');
  const [selectedEvent, setSelectedEvent] = useState<DetectionAuditEvent | null>(null);

  const fetchEvents = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.detectionAudit.recent(params.channelId, {
        limit: 100,
        decision: decisionFilter === 'all' ? undefined : decisionFilter,
      });
      setEvents(res.data.events);
      setNextCursor(res.data.nextCursor);
    } catch (err) {
      setMessage({
        type: 'error',
        text: `Failed to load audit events: ${(err as Error).message}`,
      });
    } finally {
      setLoading(false);
    }
  }, [params.channelId, decisionFilter]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // --------------------------------------------------------------------
  // T081 repeat-offender grouping: compute which external_user_ids have
  // more than REPEAT_OFFENDER_THRESHOLD non-allow decisions within the
  // rolling 24-hour window ending at "now". The count includes any event
  // currently in the loaded page; cursoring further back would give us a
  // more complete picture, but the threshold check against the current
  // page is a useful signal on its own for the admin surface.
  // --------------------------------------------------------------------
  const repeatOffenders = useMemo(() => {
    const cutoff = Date.now() - REPEAT_OFFENDER_WINDOW_MS;
    const counts = new Map<string, number>();
    for (const event of events) {
      if (event.decision === 'allow') continue;
      if (new Date(event.createdAt).getTime() < cutoff) continue;
      counts.set(event.externalUserId, (counts.get(event.externalUserId) ?? 0) + 1);
    }
    const offenders = new Set<string>();
    for (const [userId, count] of counts) {
      if (count > REPEAT_OFFENDER_THRESHOLD) offenders.add(userId);
    }
    return offenders;
  }, [events]);

  const handleAnnotate = async (
    eventId: string,
    annotationKind: 'false_positive' | 'confirmed_true_positive' | 'under_review',
  ) => {
    setMessage(null);
    try {
      await api.detectionAudit.annotate(params.channelId, eventId, { annotationKind });
      setMessage({ type: 'success', text: `Annotation "${annotationKind}" recorded.` });
      await fetchEvents();
      if (selectedEvent?.id === eventId) {
        // Refresh the detail view so the new annotation shows up.
        const refreshed = await api.detectionAudit.byReference(
          params.channelId,
          selectedEvent.referenceId,
        );
        setSelectedEvent(refreshed.data);
      }
    } catch (err) {
      setMessage({
        type: 'error',
        text: `Failed to annotate: ${(err as Error).message}`,
      });
    }
  };

  const handleDrillDown = async (referenceId: string) => {
    setMessage(null);
    try {
      const res = await api.detectionAudit.byReference(params.channelId, referenceId);
      setSelectedEvent(res.data);
    } catch (err) {
      setMessage({
        type: 'error',
        text: `Failed to load event detail: ${(err as Error).message}`,
      });
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Recent Detection Events</CardTitle>
          <CardDescription>
            Audit trail for the multi-layer injection detection pipeline (FR-015). Events are
            bounded by the channel's `auditRetentionDays` retention window (default 7 days).
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

          {repeatOffenders.size > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
              <strong>⚠ Repeat-offender alert:</strong> {repeatOffenders.size} user(s) have more
              than {REPEAT_OFFENDER_THRESHOLD} non-allow decisions in the last 24 hours —{' '}
              {Array.from(repeatOffenders).join(', ')}. Consider adjusting the channel's defense
              profile or reviewing these users' recent activity.
            </div>
          )}

          <div className="flex items-center gap-4">
            <div className="space-y-1">
              <Label htmlFor="decision-filter" className="text-xs">
                Decision filter
              </Label>
              <Select
                value={decisionFilter}
                onValueChange={(v) => setDecisionFilter(v as DecisionFilter)}
              >
                <SelectTrigger id="decision-filter" className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All decisions</SelectItem>
                  <SelectItem value="block">Block only</SelectItem>
                  <SelectItem value="flag">Flag only</SelectItem>
                  <SelectItem value="neutralize">Neutralize only</SelectItem>
                  <SelectItem value="allow">Allow (above-threshold)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" onClick={fetchEvents} disabled={loading}>
              {loading ? 'Loading...' : 'Refresh'}
            </Button>
          </div>

          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">
              Showing {events.length} events
              {nextCursor ? ' (more available via cursor; pagination UI not yet wired)' : ''}
            </div>
            {loading ? (
              <div className="text-sm text-muted-foreground">Loading...</div>
            ) : events.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                No detection events to display for the current filter.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="p-2 text-left font-medium">Time</th>
                      <th className="p-2 text-left font-medium">Decision</th>
                      <th className="p-2 text-left font-medium">Reason</th>
                      <th className="p-2 text-left font-medium">Layers</th>
                      <th className="p-2 text-left font-medium">User</th>
                      <th className="p-2 text-left font-medium">Ref</th>
                      <th className="p-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((event) => {
                      const isOffender = repeatOffenders.has(event.externalUserId);
                      return (
                        <tr
                          key={event.id}
                          className={`border-t ${
                            isOffender ? 'bg-amber-500/5' : ''
                          } hover:bg-muted/30`}
                        >
                          <td className="p-2 font-mono text-xs">
                            {new Date(event.createdAt).toLocaleString()}
                          </td>
                          <td className="p-2">
                            <span
                              className={`inline-flex rounded px-2 py-0.5 font-medium text-xs ${
                                event.decision === 'block'
                                  ? 'bg-red-500/10 text-red-700 dark:text-red-400'
                                  : event.decision === 'flag'
                                    ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                                    : event.decision === 'neutralize'
                                      ? 'bg-purple-500/10 text-purple-700 dark:text-purple-400'
                                      : 'bg-green-500/10 text-green-700 dark:text-green-400'
                              }`}
                            >
                              {event.decision}
                            </span>
                          </td>
                          <td className="p-2 font-mono text-xs">{event.reasonCode}</td>
                          <td className="p-2 font-mono text-xs">{event.layersFired.join(', ')}</td>
                          <td
                            className={`p-2 text-xs ${
                              isOffender ? 'font-semibold text-amber-700 dark:text-amber-400' : ''
                            }`}
                          >
                            {event.externalUserId}
                            {isOffender && ' ⚠'}
                          </td>
                          <td className="p-2 font-mono text-xs">{event.referenceId}</td>
                          <td className="p-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleDrillDown(event.referenceId)}
                            >
                              Details
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {selectedEvent && (
        <Card>
          <CardHeader>
            <CardTitle>Event Detail — {selectedEvent.referenceId}</CardTitle>
            <CardDescription>
              {selectedEvent.decision} · {selectedEvent.reasonCode} · risk score{' '}
              {selectedEvent.riskScore}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <div className="text-xs font-semibold text-muted-foreground">Redacted excerpt</div>
              <div className="rounded border bg-muted/30 p-3 font-mono text-xs">
                {selectedEvent.redactedExcerpt}
              </div>
            </div>
            <div className="grid gap-4 text-xs sm:grid-cols-2">
              <div>
                <div className="font-semibold text-muted-foreground">User</div>
                <div>{selectedEvent.externalUserId}</div>
              </div>
              <div>
                <div className="font-semibold text-muted-foreground">Thread</div>
                <div>{selectedEvent.threadId ?? '—'}</div>
              </div>
              <div>
                <div className="font-semibold text-muted-foreground">Source</div>
                <div>{selectedEvent.sourceKind}</div>
              </div>
              <div>
                <div className="font-semibold text-muted-foreground">Layers fired</div>
                <div className="font-mono">{selectedEvent.layersFired.join(', ')}</div>
              </div>
              <div>
                <div className="font-semibold text-muted-foreground">Canary hit</div>
                <div>{selectedEvent.canaryHit ? 'yes' : 'no'}</div>
              </div>
              <div>
                <div className="font-semibold text-muted-foreground">Created</div>
                <div>{new Date(selectedEvent.createdAt).toLocaleString()}</div>
              </div>
            </div>

            {selectedEvent.annotations.length > 0 && (
              <div className="space-y-1">
                <div className="text-xs font-semibold text-muted-foreground">
                  Existing annotations
                </div>
                <div className="space-y-2">
                  {selectedEvent.annotations.map((a) => (
                    <div key={a.id} className="rounded border bg-muted/30 p-2 text-xs">
                      <div className="font-mono">{a.kind}</div>
                      <div className="text-muted-foreground">
                        by {a.annotatedBy} at {new Date(a.createdAt).toLocaleString()}
                      </div>
                      {a.note && <div className="mt-1">{a.note}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <div className="text-xs font-semibold text-muted-foreground">Annotate</div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleAnnotate(selectedEvent.id, 'false_positive')}
                >
                  Mark false positive
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleAnnotate(selectedEvent.id, 'confirmed_true_positive')}
                >
                  Confirm true positive
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleAnnotate(selectedEvent.id, 'under_review')}
                >
                  Under review
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedEvent(null)}
                  className="ml-auto"
                >
                  Close
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
