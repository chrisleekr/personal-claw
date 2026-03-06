import type { MCPTransportType } from '@personalclaw/shared';
import { Button } from '@/components/ui/button';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { MCPFormState } from './use-mcp-form';

interface MCPConfigFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: boolean;
  form: MCPFormState;
  isStdio: boolean;
  setField: <K extends keyof MCPFormState>(key: K, value: MCPFormState[K]) => void;
  onSubmit: () => void;
  onCancel: () => void;
  triggerLabel: string;
  onTriggerClick: () => void;
}

export function MCPConfigForm({
  open,
  onOpenChange,
  editing,
  form,
  isStdio,
  setField,
  onSubmit,
  onCancel,
  triggerLabel,
  onTriggerClick,
}: MCPConfigFormProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" onClick={onTriggerClick}>
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit Server' : 'New Server'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="form-name">Server name</Label>
            <Input
              id="form-name"
              type="text"
              placeholder="Server name"
              value={form.name}
              onChange={(e) => setField('name', e.target.value)}
            />
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Label htmlFor="form-transport" className="text-muted-foreground">
                Transport:
              </Label>
              <Select
                value={form.transport}
                onValueChange={(v) => setField('transport', v as MCPTransportType)}
              >
                <SelectTrigger id="form-transport" className="w-[120px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sse">SSE</SelectItem>
                  <SelectItem value="http">HTTP</SelectItem>
                  <SelectItem value="stdio">stdio</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="form-enabled"
                checked={form.enabled}
                onCheckedChange={(checked) => setField('enabled', checked === true)}
              />
              <Label htmlFor="form-enabled" className="font-normal cursor-pointer">
                Enabled
              </Label>
            </div>
          </div>

          {isStdio ? (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="form-command">Command</Label>
                <Input
                  id="form-command"
                  type="text"
                  placeholder="e.g. npx, uvx, node"
                  value={form.command}
                  onChange={(e) => setField('command', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="form-args">Arguments</Label>
                <Textarea
                  id="form-args"
                  placeholder={
                    'Arguments (one per line)\ne.g.\n-y\n@modelcontextprotocol/server-filesystem\n/tmp'
                  }
                  value={form.args}
                  onChange={(e) => setField('args', e.target.value)}
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="form-env">Environment variables</Label>
                <Textarea
                  id="form-env"
                  placeholder={'KEY=VALUE, one per line\ne.g.\nAPI_KEY=sk-abc123'}
                  value={form.env}
                  onChange={(e) => setField('env', e.target.value)}
                  rows={2}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="form-cwd">Working directory (optional)</Label>
                <Input
                  id="form-cwd"
                  type="text"
                  placeholder="Working directory (optional)"
                  value={form.cwd}
                  onChange={(e) => setField('cwd', e.target.value)}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="form-url">Server URL</Label>
                <Input
                  id="form-url"
                  type="url"
                  placeholder="e.g. https://mcp.example.com/sse"
                  value={form.url}
                  onChange={(e) => setField('url', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="form-headers">Headers</Label>
                <Textarea
                  id="form-headers"
                  placeholder={'KEY=VALUE, one per line\ne.g.\nAuthorization=Bearer sk-abc123'}
                  value={form.headers}
                  onChange={(e) => setField('headers', e.target.value)}
                  rows={2}
                />
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button type="button" onClick={onSubmit}>
              {editing ? 'Update' : 'Create'}
            </Button>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
