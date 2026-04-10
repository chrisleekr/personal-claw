import type {
  ApprovalPolicyRecord,
  BudgetStatus,
  ChannelConfig,
  ChannelMemory,
  Conversation,
  ConversationListItem,
  CreateChannelInput,
  CreateMCPConfigInput,
  CreateScheduleInput,
  CreateSkillInput,
  MCPConfig,
  MCPToolInfo,
  Schedule,
  Skill,
  SkillDraft,
  SkillStats,
  ToolPolicy,
  UpdateChannelInput,
  UpdateMemoryInput,
  UpdateSkillInput,
} from '@personalclaw/shared';

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const { headers: optionHeaders, ...rest } = options ?? {};
  const response = await fetch(`/api/proxy${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(optionHeaders as Record<string, string>),
    },
  });
  if (!response.ok) {
    let serverMessage = '';
    try {
      const body = (await response.json()) as { message?: string };
      serverMessage = body.message ?? '';
    } catch {
      /* response body not JSON */
    }
    throw new Error(serverMessage || `API error: ${response.status} ${response.statusText}`);
  }
  return response.json() as T;
}

/**
 * Shape of a single per-channel detection override row as returned by the
 * `detection-overrides` route (FR-033). Kept local to this client file
 * because the backend returns the raw Drizzle row and there is no shared
 * type export for it yet.
 */
export interface DetectionOverride {
  id: string;
  channelId: string;
  overrideKind: 'allowlist_signature' | 'block_phrase' | 'trust_mcp_tool';
  targetKey: string;
  justification: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateDetectionOverrideInput {
  overrideKind: 'allowlist_signature' | 'block_phrase' | 'trust_mcp_tool';
  targetKey: string;
  justification: string;
}

/**
 * Shape of a detection audit event as returned by the `detection-audit`
 * route (FR-015). Same local-to-client-file rationale as `DetectionOverride`.
 */
export interface DetectionAuditAnnotation {
  id: string;
  kind: 'false_positive' | 'confirmed_true_positive' | 'under_review';
  annotatedBy: string;
  note: string | null;
  createdAt: string;
}

export interface DetectionAuditEvent {
  id: string;
  channelId: string;
  externalUserId: string;
  threadId: string | null;
  decision: 'allow' | 'flag' | 'neutralize' | 'block';
  riskScore: number;
  layersFired: string[];
  reasonCode: string;
  redactedExcerpt: string;
  referenceId: string;
  sourceKind: string;
  canaryHit: boolean;
  createdAt: string;
  annotations: DetectionAuditAnnotation[];
}

export interface DetectionAuditRecentQuery {
  limit?: number;
  cursor?: string;
  decision?: 'allow' | 'flag' | 'neutralize' | 'block';
  since?: string;
  until?: string;
}

export const api = {
  channels: {
    list: () => fetchApi<{ data: ChannelConfig[] }>('/api/channels'),
    get: (id: string) => fetchApi<{ data: ChannelConfig }>(`/api/channels/${id}`),
    create: (data: CreateChannelInput) =>
      fetchApi<{ data: ChannelConfig }>('/api/channels', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: UpdateChannelInput) =>
      fetchApi<{ data: ChannelConfig }>(`/api/channels/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetchApi<{ data: { deleted: boolean } }>(`/api/channels/${id}`, { method: 'DELETE' }),
  },
  /**
   * Per-channel detection audit admin endpoints (FR-015). All routes are
   * admin-only; the proxy injects `X-User-Id` from the authenticated
   * session and the backend verifies membership in `channelAdmins`.
   *
   * Before using the UI, the web user's email must be added to
   * `channels.channelAdmins` for the target channel.
   */
  detectionAudit: {
    recent: (channelId: string, query: DetectionAuditRecentQuery = {}) => {
      const params = new URLSearchParams();
      if (query.limit !== undefined) params.set('limit', String(query.limit));
      if (query.cursor) params.set('cursor', query.cursor);
      if (query.decision) params.set('decision', query.decision);
      if (query.since) params.set('since', query.since);
      if (query.until) params.set('until', query.until);
      const qs = params.toString();
      return fetchApi<{ data: { events: DetectionAuditEvent[]; nextCursor: string | null } }>(
        `/api/channels/${channelId}/detection-audit/recent${qs ? `?${qs}` : ''}`,
      );
    },
    byReference: (channelId: string, referenceId: string) =>
      fetchApi<{ data: DetectionAuditEvent }>(
        `/api/channels/${channelId}/detection-audit/by-reference/${referenceId}`,
      ),
    annotate: (
      channelId: string,
      auditEventId: string,
      input: {
        annotationKind: 'false_positive' | 'confirmed_true_positive' | 'under_review';
        note?: string;
      },
    ) =>
      fetchApi<{ data: DetectionAuditAnnotation & { auditEventId: string; channelId: string } }>(
        `/api/channels/${channelId}/detection-audit/${auditEventId}/annotate`,
        {
          method: 'POST',
          body: JSON.stringify(input),
        },
      ),
  },
  /**
   * Per-channel detection override CRUD (FR-033). Write operations require
   * the caller to be listed in `channels.channelAdmins` for the target
   * channel. The `X-User-Id` header is injected by the proxy from the
   * authenticated Next.js session (see proxy/[...path]/route.ts), so the
   * browser never controls its own identity and the client surface stays
   * clean — no adminUserId argument needed.
   *
   * Before using the UI, the web user's email must be added to
   * `channels.channelAdmins` for the target channel (via the Slack
   * `/pclaw admin add <email>` command or a manual SQL update).
   */
  detectionOverrides: {
    list: (channelId: string) =>
      fetchApi<{ data: { overrides: DetectionOverride[] } }>(
        `/api/channels/${channelId}/detection-overrides`,
      ),
    create: (channelId: string, data: CreateDetectionOverrideInput) =>
      fetchApi<{ data: DetectionOverride }>(`/api/channels/${channelId}/detection-overrides`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (channelId: string, id: string, justification: string) =>
      fetchApi<{ data: DetectionOverride }>(
        `/api/channels/${channelId}/detection-overrides/${id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ justification }),
        },
      ),
    delete: async (channelId: string, id: string) => {
      const res = await fetch(`/api/proxy/api/channels/${channelId}/detection-overrides/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(`Failed to delete override (${res.status})`);
      // 204 No Content — nothing to parse.
      return { ok: true };
    },
  },
  skills: {
    list: (channelId: string) => fetchApi<{ data: Skill[] }>(`/api/skills/${channelId}`),
    create: (data: CreateSkillInput) =>
      fetchApi<{ data: Skill }>('/api/skills', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: UpdateSkillInput) =>
      fetchApi<{ data: Skill }>(`/api/skills/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) =>
      fetchApi<{ data: { deleted: boolean } }>(`/api/skills/${id}`, { method: 'DELETE' }),
  },
  mcp: {
    list: () => fetchApi<{ data: MCPConfig[] }>('/api/mcp'),
    listForChannel: (channelId: string) =>
      fetchApi<{ data: MCPConfig[] }>(`/api/mcp/channel/${channelId}`),
    create: (data: CreateMCPConfigInput) =>
      fetchApi<{ data: MCPConfig }>('/api/mcp', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: Record<string, unknown>) =>
      fetchApi<{ data: MCPConfig }>(`/api/mcp/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetchApi<{ data: { deleted: boolean } }>(`/api/mcp/${id}`, { method: 'DELETE' }),
    test: (id: string) =>
      fetchApi<{ data: { ok: boolean; toolCount: number } }>(`/api/mcp/${id}/test`, {
        method: 'POST',
      }),
    listTools: (id: string) => fetchApi<{ data: MCPToolInfo[] }>(`/api/mcp/${id}/tools`),
    getToolPolicy: (id: string, channelId?: string) =>
      fetchApi<{ data: { disabledTools: string[] } }>(
        `/api/mcp/${id}/tool-policy${channelId ? `?channelId=${channelId}` : ''}`,
      ),
    updateToolPolicy: (id: string, data: { channelId: string | null; disabledTools: string[] }) =>
      fetchApi<{ data: ToolPolicy }>(`/api/mcp/${id}/tool-policy`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    deleteToolPolicy: (id: string, channelId: string) =>
      fetchApi<{ data: { deleted: boolean } }>(
        `/api/mcp/${id}/tool-policy?channelId=${channelId}`,
        { method: 'DELETE' },
      ),
  },
  schedules: {
    list: (channelId: string) => fetchApi<{ data: Schedule[] }>(`/api/schedules/${channelId}`),
    create: (data: CreateScheduleInput) =>
      fetchApi<{ data: Schedule }>('/api/schedules', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: Record<string, unknown>) =>
      fetchApi<{ data: Schedule }>(`/api/schedules/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetchApi<{ data: { deleted: boolean } }>(`/api/schedules/${id}`, { method: 'DELETE' }),
  },
  identity: {
    get: (channelId: string) =>
      fetchApi<{
        data: {
          identityPrompt: string | null;
          teamPrompt: string | null;
          threadReplyMode: string;
          autonomyLevel: string;
        };
      }>(`/api/identity/${channelId}`),
    update: (
      channelId: string,
      data: {
        identityPrompt?: string;
        teamPrompt?: string;
        threadReplyMode?: string;
        autonomyLevel?: string;
      },
    ) =>
      fetchApi<{
        data: {
          identityPrompt: string | null;
          teamPrompt: string | null;
          threadReplyMode: string;
          autonomyLevel: string;
        };
      }>(`/api/identity/${channelId}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
  },
  memories: {
    list: (channelId: string) => fetchApi<{ data: ChannelMemory[] }>(`/api/memories/${channelId}`),
    search: (channelId: string, query: string) =>
      fetchApi<{ data: ChannelMemory[] }>(
        `/api/memories/${channelId}/search?q=${encodeURIComponent(query)}`,
      ),
    update: (id: string, data: UpdateMemoryInput) =>
      fetchApi<{ data: unknown }>(`/api/memories/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetchApi<{ data: { deleted: boolean } }>(`/api/memories/${id}`, { method: 'DELETE' }),
  },
  skillStats: {
    get: (channelId: string) =>
      fetchApi<{ data: SkillStats[] }>(`/api/skill-stats/${channelId}/stats`),
  },
  usage: {
    get: (channelId: string) =>
      fetchApi<{ data: { usage: unknown[]; totalTokens: number; totalCost: number } }>(
        `/api/usage/${channelId}`,
      ),
    getDaily: (channelId: string) =>
      fetchApi<{
        data: Array<{ date: string; totalTokens: number; totalCost: number; requestCount: number }>;
      }>(`/api/usage/${channelId}/daily`),
    getBudget: (channelId: string) =>
      fetchApi<{ data: BudgetStatus }>(`/api/usage/${channelId}/budget`),
  },
  conversations: {
    list: (channelId: string) =>
      fetchApi<{ data: ConversationListItem[] }>(`/api/conversations/${channelId}`),
    get: (channelId: string, id: string) =>
      fetchApi<{ data: Conversation }>(`/api/conversations/${channelId}/${id}`),
    generateSkill: (channelId: string, id: string) =>
      fetchApi<{ data: SkillDraft }>(`/api/conversations/${channelId}/${id}/generate-skill`, {
        method: 'POST',
      }),
  },
  approvals: {
    list: (channelId: string) =>
      fetchApi<{ data: ApprovalPolicyRecord[] }>(`/api/approvals/${channelId}`),
    create: (data: {
      channelId: string;
      toolName: string;
      policy?: string;
      allowedUsers?: string[];
    }) =>
      fetchApi<{ data: ApprovalPolicyRecord }>('/api/approvals', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetchApi<{ data: { deleted: boolean } }>(`/api/approvals/${id}`, { method: 'DELETE' }),
  },
};
