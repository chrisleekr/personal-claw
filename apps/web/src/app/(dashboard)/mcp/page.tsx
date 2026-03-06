'use client';

import type { MCPConfig, MCPToolInfo } from '@personalclaw/shared';
import { useCallback, useState } from 'react';
import { MCPConfigCard } from '@/components/mcp/mcp-config-card';
import { MCPConfigForm } from '@/components/mcp/mcp-config-form';
import { useMCPForm } from '@/components/mcp/use-mcp-form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { api } from '@/lib/api-client';

interface ToolsState {
  loading: boolean;
  tools?: MCPToolInfo[];
  disabledTools?: string[];
  error?: string;
  saving?: boolean;
}

function ToolToggleSection({ configId }: { configId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [state, setState] = useState<ToolsState>({ loading: false });

  const loadTools = useCallback(async () => {
    setState({ loading: true });
    try {
      const [toolsRes, policyRes] = await Promise.all([
        api.mcp.listTools(configId),
        api.mcp.getToolPolicy(configId),
      ]);
      setState({
        loading: false,
        tools: toolsRes.data,
        disabledTools: policyRes.data.disabledTools,
      });
    } catch (err) {
      setState({ loading: false, error: (err as Error).message });
    }
  }, [configId]);

  const handleExpand = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !state.tools && !state.loading) {
      loadTools();
    }
  };

  const toggleTool = async (toolName: string) => {
    if (!state.tools || !state.disabledTools) return;
    const isCurrentlyDisabled = state.disabledTools.includes(toolName);
    const newDisabled = isCurrentlyDisabled
      ? state.disabledTools.filter((t) => t !== toolName)
      : [...state.disabledTools, toolName];

    setState((prev) => ({ ...prev, disabledTools: newDisabled, saving: true }));
    try {
      await api.mcp.updateToolPolicy(configId, {
        channelId: null,
        disabledTools: newDisabled,
      });
    } catch {
      setState((prev) => ({
        ...prev,
        disabledTools: state.disabledTools,
      }));
    } finally {
      setState((prev) => ({ ...prev, saving: false }));
    }
  };

  const enabledCount =
    state.tools && state.disabledTools
      ? state.tools.length - state.disabledTools.length
      : undefined;

  return (
    <div className="mt-3 pt-3">
      <Separator className="mb-3" />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={handleExpand}
        className="flex items-center gap-2 text-muted-foreground hover:text-foreground w-full justify-start h-auto py-0"
      >
        <span
          className="transition-transform"
          style={{ transform: expanded ? 'rotate(90deg)' : undefined }}
        >
          &#9654;
        </span>
        <span>Tools</span>
        {enabledCount !== undefined && (
          <Badge variant="secondary" className="text-xs">
            {enabledCount} / {state.tools?.length} enabled
          </Badge>
        )}
        {state.saving && <span className="text-xs text-muted-foreground">Saving...</span>}
      </Button>

      {expanded && (
        <div className="mt-2 space-y-1">
          {state.loading && (
            <p className="text-xs text-muted-foreground pl-5">Connecting to server...</p>
          )}
          {state.error && (
            <div className="pl-5">
              <p className="text-xs text-red-600 dark:text-red-400">{state.error}</p>
              <Button
                type="button"
                variant="link"
                size="sm"
                className="text-xs h-auto p-0 mt-1"
                onClick={loadTools}
              >
                Retry
              </Button>
            </div>
          )}
          {state.tools &&
            state.disabledTools &&
            (state.tools.length === 0 ? (
              <p className="text-xs text-muted-foreground pl-5">No tools exposed by this server.</p>
            ) : (
              state.tools.map((tool) => {
                const disabled = state.disabledTools?.includes(tool.name);
                return (
                  <Label
                    key={tool.name}
                    className="flex items-start gap-2 pl-5 py-1 cursor-pointer group"
                  >
                    <Checkbox
                      checked={!disabled}
                      onCheckedChange={() => toggleTool(tool.name)}
                      className="mt-0.5"
                    />
                    <div className="min-w-0">
                      <span
                        className={`text-sm font-mono ${disabled ? 'text-muted-foreground line-through' : ''}`}
                      >
                        {tool.name}
                      </span>
                      {tool.description && (
                        <p className="text-xs text-muted-foreground truncate max-w-md">
                          {tool.description}
                        </p>
                      )}
                    </div>
                  </Label>
                );
              })
            ))}
        </div>
      )}
    </div>
  );
}

export default function MCPServersPage() {
  const fetchConfigs = useCallback(async () => {
    const res = await api.mcp.list();
    return res.data;
  }, []);

  const {
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
  } = useMCPForm({
    fetchConfigs,
    apiCreate: (p) => api.mcp.create(p as Parameters<typeof api.mcp.create>[0]),
    apiUpdate: (id, p) => api.mcp.update(id, p),
    apiDelete: (id) => api.mcp.delete(id),
    apiTest: (id) => api.mcp.test(id),
  });

  if (loading) {
    return <div className="text-muted-foreground">Loading...</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">MCP Servers</h1>
          <p className="text-muted-foreground">
            Manage global Model Context Protocol server connections. These are available to all
            channels.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <MCPConfigForm
            open={showForm}
            onOpenChange={(open) => {
              setShowForm(open);
              if (!open) resetForm();
            }}
            editing={!!editingConfig}
            form={form}
            isStdio={isStdio}
            setField={setField}
            onSubmit={handleSubmit}
            onCancel={resetForm}
            triggerLabel="Add Server"
            onTriggerClick={() => {
              resetForm();
              setShowForm(true);
            }}
          />
        </div>
      </div>

      {configs.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            No MCP servers configured. Click &quot;Add Server&quot; to connect one.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {configs.map((config: MCPConfig) => (
            <MCPConfigCard
              key={config.id}
              config={config}
              testResult={testResults[config.id]}
              onTest={handleTest}
              onEdit={handleEdit}
              onDelete={handleDelete}
            >
              <ToolToggleSection configId={config.id} />
            </MCPConfigCard>
          ))}
        </div>
      )}
    </div>
  );
}
