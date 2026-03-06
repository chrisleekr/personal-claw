import type { MCPConfig, MCPTransportType } from '@personalclaw/shared';
import { useCallback, useEffect, useState } from 'react';
import { parseArgs, parseKeyValue } from './config-summary';

export interface TestResult {
  loading: boolean;
  ok?: boolean;
  toolCount?: number;
  error?: string;
}

export interface MCPFormState {
  name: string;
  transport: MCPTransportType;
  enabled: boolean;
  url: string;
  command: string;
  args: string;
  env: string;
  cwd: string;
  headers: string;
}

export function useMCPForm(opts: {
  fetchConfigs: () => Promise<MCPConfig[]>;
  buildPayload?: (base: Record<string, unknown>) => Record<string, unknown>;
  apiCreate: (payload: Record<string, unknown>) => Promise<unknown>;
  apiUpdate: (id: string, payload: Record<string, unknown>) => Promise<unknown>;
  apiDelete: (id: string) => Promise<unknown>;
  apiTest: (id: string) => Promise<{ data: { ok: boolean; toolCount: number } }>;
}) {
  const { fetchConfigs, buildPayload, apiCreate, apiUpdate, apiDelete, apiTest } = opts;

  const [configs, setConfigs] = useState<MCPConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingConfig, setEditingConfig] = useState<MCPConfig | null>(null);

  const [form, setForm] = useState<MCPFormState>({
    name: '',
    transport: 'sse',
    enabled: true,
    url: '',
    command: '',
    args: '',
    env: '',
    cwd: '',
    headers: '',
  });

  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});

  const isStdio = form.transport === 'stdio';

  const loadConfigs = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchConfigs();
      setConfigs(data);
    } catch {
      // silently handle
    } finally {
      setLoading(false);
    }
  }, [fetchConfigs]);

  useEffect(() => {
    loadConfigs();
  }, [loadConfigs]);

  const setField = <K extends keyof MCPFormState>(key: K, value: MCPFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const resetForm = () => {
    setForm({
      name: '',
      transport: 'sse',
      enabled: true,
      url: '',
      command: '',
      args: '',
      env: '',
      cwd: '',
      headers: '',
    });
    setEditingConfig(null);
    setShowForm(false);
  };

  const handleSubmit = async () => {
    try {
      let payload: Record<string, unknown> = isStdio
        ? {
            serverName: form.name,
            transportType: form.transport,
            enabled: form.enabled,
            serverUrl: null,
            command: form.command || null,
            args: parseArgs(form.args),
            env: parseKeyValue(form.env),
            cwd: form.cwd || null,
          }
        : {
            serverName: form.name,
            transportType: form.transport,
            enabled: form.enabled,
            serverUrl: form.url,
            headers: parseKeyValue(form.headers),
            command: null,
            args: null,
            env: null,
            cwd: null,
          };

      if (buildPayload) {
        payload = buildPayload(payload);
      }

      if (editingConfig) {
        await apiUpdate(editingConfig.id, payload);
      } else {
        await apiCreate(payload);
      }
      resetForm();
      loadConfigs();
    } catch {
      // silently handle
    }
  };

  const handleEdit = (config: MCPConfig) => {
    setEditingConfig(config);
    setForm({
      name: config.serverName,
      transport: config.transportType,
      enabled: config.enabled,
      url: config.serverUrl ?? '',
      command: config.command ?? '',
      args: config.args?.join('\n') ?? '',
      env: config.env
        ? Object.entries(config.env)
            .map(([k, v]) => `${k}=${v}`)
            .join('\n')
        : '',
      cwd: config.cwd ?? '',
      headers: config.headers
        ? Object.entries(config.headers)
            .map(([k, v]) => `${k}=${v}`)
            .join('\n')
        : '',
    });
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    try {
      await apiDelete(id);
      loadConfigs();
    } catch {
      // silently handle
    }
  };

  const handleTest = async (id: string) => {
    setTestResults((prev) => ({ ...prev, [id]: { loading: true } }));
    try {
      const res = await apiTest(id);
      setTestResults((prev) => ({
        ...prev,
        [id]: { loading: false, ok: true, toolCount: res.data.toolCount },
      }));
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [id]: { loading: false, ok: false, error: (err as Error).message },
      }));
    }
  };

  return {
    configs,
    loading,
    showForm,
    setShowForm,
    editingConfig,
    form,
    setField,
    isStdio,
    testResults,
    resetForm,
    handleSubmit,
    handleEdit,
    handleDelete,
    handleTest,
    refetch: loadConfigs,
  };
}
