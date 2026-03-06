'use client';

import type {
  Conversation,
  ConversationListItem,
  ConversationMessage,
  SkillDraft,
  ToolCallRecord,
} from '@personalclaw/shared';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api-client';

function formatDate(date: Date | string) {
  return new Date(date).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function relativeTime(date: Date | string) {
  const now = Date.now();
  const then = new Date(date).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return formatDate(date);
}

function truncate(text: string, maxLen: number) {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen).trimEnd()}…`;
}

function conversationTitle(conv: ConversationListItem) {
  if (conv.summary) return truncate(conv.summary, 120);
  if (conv.firstMessage) return truncate(conv.firstMessage, 120);
  return conv.externalThreadId;
}

function ToolCallDetail({ toolCall }: { toolCall: ToolCallRecord }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mt-2 border border-border rounded-md text-xs">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-muted/50 transition-colors"
      >
        <span className="font-mono font-medium">{toolCall.toolName}</span>
        <span className="flex items-center gap-2">
          <span className="text-muted-foreground">{toolCall.durationMs}ms</span>
          {toolCall.requiresApproval && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              {toolCall.approved ? 'approved' : toolCall.approved === false ? 'denied' : 'pending'}
            </Badge>
          )}
          <span className="text-muted-foreground">{expanded ? '▲' : '▼'}</span>
        </span>
      </button>
      {expanded && (
        <div className="border-t border-border px-3 py-2 space-y-2">
          <div>
            <span className="text-muted-foreground">Args:</span>
            <pre className="mt-1 bg-muted/30 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
              {JSON.stringify(toolCall.args, null, 2)}
            </pre>
          </div>
          <div>
            <span className="text-muted-foreground">Result:</span>
            <pre className="mt-1 bg-muted/30 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
              {typeof toolCall.result === 'string'
                ? toolCall.result
                : JSON.stringify(toolCall.result, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

function MessageBubble({ message }: { message: ConversationMessage }) {
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  return (
    <div
      className={`flex ${isUser ? 'justify-start' : isSystem ? 'justify-center' : 'justify-end'}`}
    >
      <div
        className={`max-w-[80%] rounded-lg px-4 py-2.5 ${
          isUser
            ? 'bg-muted text-foreground'
            : isSystem
              ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400 text-xs italic'
              : 'bg-primary/10 text-foreground'
        }`}
      >
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-medium capitalize">{message.role}</span>
          {message.externalUserId && (
            <span className="text-xs text-muted-foreground">({message.externalUserId})</span>
          )}
          <span className="text-xs text-muted-foreground">{formatDate(message.timestamp)}</span>
        </div>
        <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>
        {message.toolCalls?.map((tc) => (
          <ToolCallDetail key={`${tc.toolName}-${tc.durationMs}`} toolCall={tc} />
        ))}
      </div>
    </div>
  );
}

function ConversationDetail({
  channelId,
  conversationId,
  onBack,
}: {
  channelId: string;
  conversationId: string;
  onBack: () => void;
}) {
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [showSkillDialog, setShowSkillDialog] = useState(false);
  const [skillDraft, setSkillDraft] = useState<SkillDraft | null>(null);
  const [skillName, setSkillName] = useState('');
  const [skillContent, setSkillContent] = useState('');
  const [skillEnabled, setSkillEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api.conversations
      .get(channelId, conversationId)
      .then((res) => setConversation(res.data))
      .catch((err) => {
        const msg = err instanceof Error ? err.message : 'Failed to load conversation';
        setError(msg);
      })
      .finally(() => setLoading(false));
  }, [channelId, conversationId]);

  const hasToolCalls = conversation
    ? ((conversation.messages ?? []) as ConversationMessage[]).some(
        (m) => m.toolCalls && m.toolCalls.length > 0,
      )
    : false;

  const handleGenerateSkill = async () => {
    setGenerating(true);
    setSaveSuccess(false);
    setError(null);
    try {
      const res = await api.conversations.generateSkill(channelId, conversationId);
      setSkillDraft(res.data);
      setSkillName(res.data.name);
      setSkillContent(res.data.content);
      setSkillEnabled(true);
      setShowSkillDialog(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to generate skill';
      setError(msg);
    } finally {
      setGenerating(false);
    }
  };

  const handleSaveSkill = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.skills.create({
        channelId,
        name: skillName,
        content: skillContent,
        enabled: skillEnabled,
      });
      setSaveSuccess(true);
      setShowSkillDialog(false);
      setSkillDraft(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save skill';
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-muted-foreground">Loading conversation...</div>;
  }

  if (!conversation) {
    return (
      <div>
        <Button variant="ghost" size="sm" onClick={onBack} className="mb-4">
          ← Back to list
        </Button>
        {error ? (
          <Card className="border-red-200 dark:border-red-800">
            <CardContent className="py-4 text-sm text-red-600 dark:text-red-400">
              {error}
            </CardContent>
          </Card>
        ) : (
          <div className="text-muted-foreground">Conversation not found.</div>
        )}
      </div>
    );
  }

  const messages = (conversation.messages ?? []) as ConversationMessage[];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <Button variant="ghost" size="sm" onClick={onBack}>
          ← Back to list
        </Button>
        <div className="flex items-center gap-2">
          {error && (
            <span
              className="text-xs text-red-600 dark:text-red-400 max-w-sm truncate"
              title={error}
            >
              {error}
            </span>
          )}
          {saveSuccess && (
            <span className="text-xs text-green-600 dark:text-green-400">Skill created</span>
          )}
          {hasToolCalls && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleGenerateSkill}
              disabled={generating}
            >
              {generating ? 'Generating...' : 'Generate Skill'}
            </Button>
          )}
        </div>
      </div>

      <div className="mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">
            {conversation.summary ? truncate(conversation.summary, 100) : 'Conversation'}
          </h2>
          {conversation.isCompacted && (
            <Badge
              variant="secondary"
              className="bg-amber-500/10 text-amber-700 dark:text-amber-400"
            >
              compacted
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground font-mono mt-0.5">
          Thread: {conversation.externalThreadId}
        </p>
      </div>

      {conversation.isCompacted && conversation.summary && (
        <Card className="mb-4">
          <CardContent className="pt-4">
            <p className="text-xs font-medium text-muted-foreground mb-1">Compaction Summary</p>
            <p className="text-sm">{conversation.summary}</p>
          </CardContent>
        </Card>
      )}

      <ScrollArea className="h-[calc(100vh-320px)]">
        <div className="space-y-3 pr-4">
          {messages.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              {conversation.isCompacted
                ? 'Messages were cleared during compaction. See summary above.'
                : 'No messages in this conversation.'}
            </p>
          ) : (
            messages.map((msg) => (
              <MessageBubble key={`${msg.role}-${msg.timestamp}`} message={msg} />
            ))
          )}
        </div>
      </ScrollArea>

      <Dialog
        open={showSkillDialog}
        onOpenChange={(open) => {
          setShowSkillDialog(open);
          if (!open) setSkillDraft(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Skill from Conversation</DialogTitle>
          </DialogHeader>
          {skillDraft && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="gen-skill-name">Skill name</Label>
                <Input
                  id="gen-skill-name"
                  value={skillName}
                  onChange={(e) => setSkillName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="gen-skill-content">Skill content</Label>
                <Textarea
                  id="gen-skill-content"
                  value={skillContent}
                  onChange={(e) => setSkillContent(e.target.value)}
                  className="min-h-48 font-mono text-xs"
                />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="gen-skill-enabled"
                  checked={skillEnabled}
                  onCheckedChange={(checked) => setSkillEnabled(checked === true)}
                />
                <Label htmlFor="gen-skill-enabled" className="font-normal cursor-pointer">
                  Enable immediately
                </Label>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  onClick={handleSaveSkill}
                  disabled={saving || !skillName.trim() || !skillContent.trim()}
                >
                  {saving ? 'Saving...' : 'Create Skill'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setShowSkillDialog(false);
                    setSkillDraft(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function ConversationsPage() {
  const params = useParams<{ channelId: string }>();
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const fetchConversations = useCallback(async () => {
    try {
      setLoading(true);
      setListError(null);
      const res = await api.conversations.list(params.channelId);
      setConversations(res.data ?? []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch conversations';
      setListError(msg);
    } finally {
      setLoading(false);
    }
  }, [params.channelId]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  const filtered = search
    ? conversations.filter((c) => {
        const q = search.toLowerCase();
        return (
          c.externalThreadId.toLowerCase().includes(q) ||
          c.summary?.toLowerCase().includes(q) ||
          c.firstMessage?.toLowerCase().includes(q)
        );
      })
    : conversations;

  if (selectedId) {
    return (
      <ConversationDetail
        channelId={params.channelId}
        conversationId={selectedId}
        onBack={() => setSelectedId(null)}
      />
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Conversations</h1>
          <p className="text-muted-foreground">
            Conversation threads the AI agent has participated in.
          </p>
        </div>
      </div>

      <div className="mb-4">
        <Input
          type="search"
          placeholder="Search conversations..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {listError && (
        <Card className="mb-4 border-red-200 dark:border-red-800">
          <CardContent className="py-4 text-sm text-red-600 dark:text-red-400">
            {listError}
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="text-muted-foreground">Loading...</div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            {search
              ? 'No conversations match your filter.'
              : 'No conversations yet. Conversations appear when the agent processes messages.'}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((conv) => (
            <Card
              key={conv.id}
              className="cursor-pointer hover:bg-muted/30 transition-colors"
              onClick={() => setSelectedId(conv.id)}
            >
              <CardContent className="pt-5 pb-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium leading-snug line-clamp-2">
                      {conversationTitle(conv)}
                    </p>
                    <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground">
                      <span className="font-mono truncate max-w-[12rem]">
                        {conv.externalThreadId}
                      </span>
                      {conv.isCompacted && (
                        <Badge
                          variant="secondary"
                          className="bg-amber-500/10 text-amber-700 dark:text-amber-400 text-[10px] px-1.5 py-0"
                        >
                          compacted
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 text-xs text-muted-foreground">
                    <span>{conv.messageCount} msgs</span>
                    {conv.tokenCount !== null && <span>{conv.tokenCount} tokens</span>}
                    <span>{relativeTime(conv.updatedAt)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
