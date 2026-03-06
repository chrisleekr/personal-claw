import type { MCPConfig } from '@personalclaw/shared';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { configSummary } from './config-summary';
import type { TestResult } from './use-mcp-form';

interface MCPConfigCardProps {
  config: MCPConfig;
  testResult?: TestResult;
  onTest: (id: string) => void;
  onEdit?: (config: MCPConfig) => void;
  onDelete?: (id: string) => void;
  scopeBadge?: ReactNode;
  cardClassName?: string;
  children?: ReactNode;
}

export function MCPConfigCard({
  config,
  testResult,
  onTest,
  onEdit,
  onDelete,
  scopeBadge,
  cardClassName,
  children,
}: MCPConfigCardProps) {
  return (
    <Card className={cardClassName}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold">{config.serverName}</h3>
            {scopeBadge}
            <Badge
              className={
                config.enabled
                  ? 'bg-green-500/10 text-green-700 dark:text-green-400 border-0'
                  : 'bg-muted text-muted-foreground border-0'
              }
            >
              {config.enabled ? 'Active' : 'Disabled'}
            </Badge>
            <Badge variant="secondary" className="uppercase">
              {config.transportType}
            </Badge>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="link"
              size="sm"
              className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
              onClick={() => onTest(config.id)}
              disabled={testResult?.loading}
            >
              {testResult?.loading ? 'Testing...' : 'Test'}
            </Button>
            {onEdit && (
              <Button type="button" variant="ghost" size="sm" onClick={() => onEdit(config)}>
                Edit
              </Button>
            )}
            {onDelete && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-red-500 hover:text-red-700"
                onClick={() => onDelete(config.id)}
              >
                Delete
              </Button>
            )}
          </div>
        </div>
        <p className="text-sm text-muted-foreground truncate font-mono">{configSummary(config)}</p>
        {config.headers && Object.keys(config.headers).length > 0 && (
          <p className="text-xs text-muted-foreground mt-1">
            {Object.keys(config.headers).length} header
            {Object.keys(config.headers).length > 1 ? 's' : ''} configured
          </p>
        )}
        {testResult && !testResult.loading && (
          <p
            className={`text-xs mt-1 ${
              testResult.ok
                ? 'text-green-700 dark:text-green-400'
                : 'text-red-600 dark:text-red-400'
            }`}
          >
            {testResult.ok
              ? `Connected — ${testResult.toolCount} tool${testResult.toolCount === 1 ? '' : 's'} available`
              : `Connection failed: ${testResult.error}`}
          </p>
        )}
        {children}
      </CardContent>
    </Card>
  );
}
