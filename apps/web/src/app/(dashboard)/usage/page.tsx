'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api } from '@/lib/api-client';
import { cn } from '@/lib/utils';

interface DailyUsage {
  date: string;
  totalTokens: number;
  totalCost: number;
  requestCount: number;
}

interface ChannelSummary {
  channelId: string;
  channelName: string;
  totalTokens: number;
  totalCost: number;
}

interface BudgetInfo {
  channelId: string;
  dailyBudget: number | null;
  todaySpend: number;
  percentUsed: number | null;
}

interface ChannelEntry {
  id: string;
  externalName: string | null;
  externalId: string;
}

export default function UsagePage() {
  const [channels, setChannels] = useState<ChannelEntry[]>([]);
  const [filterChannelId, setFilterChannelId] = useState<string>('all');
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [dailyUsage, setDailyUsage] = useState<DailyUsage[]>([]);
  const [channelSummaries, setChannelSummaries] = useState<ChannelSummary[]>([]);
  const [budgets, setBudgets] = useState<Record<string, BudgetInfo>>({});
  const [loading, setLoading] = useState(true);

  const loadChannels = useCallback(async () => {
    try {
      const res = await api.channels.list();
      setChannels(
        res.data.map((c) => ({ id: c.id, externalName: c.externalName, externalId: c.externalId })),
      );
      return res.data;
    } catch {
      console.error('Failed to fetch channels');
      return [];
    }
  }, []);

  const loadUsageSummaries = useCallback(async (channelList: ChannelEntry[]) => {
    try {
      const summaries = await Promise.all(
        channelList.map(async (ch) => {
          try {
            const res = await api.usage.get(ch.id);
            return {
              channelId: ch.id,
              channelName: ch.externalName || ch.externalId,
              totalTokens: res.data.totalTokens,
              totalCost: res.data.totalCost,
            };
          } catch {
            return {
              channelId: ch.id,
              channelName: ch.externalName || ch.externalId,
              totalTokens: 0,
              totalCost: 0,
            };
          }
        }),
      );
      setChannelSummaries(summaries);
    } catch {
      console.error('Failed to load usage summaries');
    }
  }, []);

  const loadBudgets = useCallback(async (channelList: ChannelEntry[]) => {
    const budgetResults = await Promise.all(
      channelList.map(async (ch) => {
        try {
          const res = await api.usage.getBudget(ch.id);
          return { channelId: ch.id, ...res.data };
        } catch {
          return { channelId: ch.id, dailyBudget: null, todaySpend: 0, percentUsed: null };
        }
      }),
    );
    const budgetMap: Record<string, BudgetInfo> = {};
    for (const b of budgetResults) budgetMap[b.channelId] = b;
    setBudgets(budgetMap);
  }, []);

  const loadDailyUsage = useCallback(async (channelId: string) => {
    try {
      const res = await api.usage.getDaily(channelId);
      setDailyUsage(res.data);
    } catch {
      console.error('Failed to fetch daily usage');
      setDailyUsage([]);
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const channelList = await loadChannels();
      const entries = channelList.map(
        (c: { id: string; externalName: string | null; externalId: string }) => ({
          id: c.id,
          externalName: c.externalName,
          externalId: c.externalId,
        }),
      );
      await Promise.all([loadUsageSummaries(entries), loadBudgets(entries)]);
      setLoading(false);
    })();
  }, [loadChannels, loadUsageSummaries, loadBudgets]);

  useEffect(() => {
    if (selectedChannel) {
      loadDailyUsage(selectedChannel);
    } else {
      setDailyUsage([]);
    }
  }, [selectedChannel, loadDailyUsage]);

  const handleFilterChange = useCallback((value: string) => {
    setFilterChannelId(value);
    setSelectedChannel(null);
  }, []);

  const filteredSummaries = useMemo(
    () =>
      filterChannelId === 'all'
        ? channelSummaries
        : channelSummaries.filter((s) => s.channelId === filterChannelId),
    [channelSummaries, filterChannelId],
  );

  const totalCost = filteredSummaries.reduce((sum, s) => sum + s.totalCost, 0);
  const totalTokens = filteredSummaries.reduce((sum, s) => sum + s.totalTokens, 0);

  if (loading) {
    return <div className="text-muted-foreground">Loading...</div>;
  }

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Usage &amp; Costs</h1>
          <p className="text-muted-foreground">Token usage and cost breakdown across channels.</p>
        </div>
        {channels.length > 1 && (
          <Select value={filterChannelId} onValueChange={handleFilterChange}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Filter channel" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Channels</SelectItem>
              {channels.map((ch) => (
                <SelectItem key={ch.id} value={ch.id}>
                  {ch.externalName || ch.externalId}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Cost</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">${totalCost.toFixed(4)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Tokens
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{totalTokens.toLocaleString()}</p>
          </CardContent>
        </Card>
      </div>

      {filteredSummaries.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No usage data yet. Usage will appear here once the agent processes messages.
          </CardContent>
        </Card>
      ) : (
        <>
          <h2 className="text-lg font-semibold mb-3">By Channel</h2>
          <div className="space-y-2 mb-6">
            {filteredSummaries.map((summary) => {
              const budget = budgets[summary.channelId];
              const isSelected = selectedChannel === summary.channelId;
              return (
                <Button
                  key={summary.channelId}
                  type="button"
                  variant="outline"
                  onClick={() => setSelectedChannel(isSelected ? null : summary.channelId)}
                  className={cn(
                    'w-full h-auto flex flex-col items-stretch justify-start p-4 text-left',
                    isSelected && 'border-primary bg-primary/5',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium">{summary.channelName}</h3>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <span>{summary.totalTokens.toLocaleString()} tokens</span>
                      <span className="font-medium text-foreground">
                        ${summary.totalCost.toFixed(4)}
                      </span>
                    </div>
                  </div>
                  {budget?.dailyBudget != null ? (
                    <div className="mt-2">
                      <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                        <span>Daily Budget</span>
                        <span>
                          ${budget.todaySpend.toFixed(2)} / ${budget.dailyBudget.toFixed(2)}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className={cn(
                            'h-full rounded-full transition-all',
                            (budget.percentUsed ?? 0) >= 100
                              ? 'bg-red-500'
                              : (budget.percentUsed ?? 0) >= 80
                                ? 'bg-yellow-500'
                                : 'bg-green-500',
                          )}
                          style={{ width: `${Math.min(budget.percentUsed ?? 0, 100)}%` }}
                        />
                      </div>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-muted-foreground">No budget set</p>
                  )}
                </Button>
              );
            })}
          </div>

          {selectedChannel && dailyUsage.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold mb-3">Daily Breakdown</h2>
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50 hover:bg-muted/50">
                        <TableHead className="text-muted-foreground">Date</TableHead>
                        <TableHead className="text-right text-muted-foreground">Requests</TableHead>
                        <TableHead className="text-right text-muted-foreground">Tokens</TableHead>
                        <TableHead className="text-right text-muted-foreground">Cost</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dailyUsage.map((day) => (
                        <TableRow key={day.date}>
                          <TableCell>{day.date}</TableCell>
                          <TableCell className="text-right">{day.requestCount}</TableCell>
                          <TableCell className="text-right">
                            {day.totalTokens.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right">${day.totalCost.toFixed(4)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          )}

          {selectedChannel && dailyUsage.length === 0 && (
            <Card>
              <CardContent className="py-6 text-center text-muted-foreground">
                No daily usage data available for this channel.
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
