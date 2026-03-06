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

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
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
