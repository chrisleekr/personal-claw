'use client';

import type { ChannelMemory, MemoryCategory } from '@personalclaw/shared';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ConfirmDialog } from '@/components/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api-client';

const CATEGORY_COLORS: Record<string, string> = {
  fact: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
  preference: 'bg-purple-500/10 text-purple-700 dark:text-purple-400',
  decision: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  person: 'bg-green-500/10 text-green-700 dark:text-green-400',
  project: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-400',
  procedure: 'bg-rose-500/10 text-rose-700 dark:text-rose-400',
};

const CATEGORIES = [
  { value: 'fact', label: 'Fact' },
  { value: 'preference', label: 'Preference' },
  { value: 'decision', label: 'Decision' },
  { value: 'person', label: 'Person' },
  { value: 'project', label: 'Project' },
  { value: 'procedure', label: 'Procedure' },
] as const;

export default function MemoryPage() {
  const params = useParams<{ channelId: string }>();
  const [memories, setMemories] = useState<ChannelMemory[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editCategory, setEditCategory] = useState<MemoryCategory>('fact');
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; content: string } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const fetchMemories = useCallback(
    async (query?: string) => {
      try {
        setLoading(true);
        const res = query
          ? await api.memories.search(params.channelId, query)
          : await api.memories.list(params.channelId);
        setMemories(res.data ?? []);
      } catch {
        console.error('Failed to fetch memories');
      } finally {
        setLoading(false);
      }
    },
    [params.channelId],
  );

  useEffect(() => {
    fetchMemories();
  }, [fetchMemories]);

  const handleSearch = (value: string) => {
    setSearch(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchMemories(value || undefined);
    }, 300);
  };

  const handleDelete = async (id: string) => {
    try {
      await api.memories.delete(id);
      setMemories((prev) => prev.filter((m) => m.id !== id));
    } catch {
      console.error('Failed to delete memory');
    }
  };

  const handleEdit = (memory: ChannelMemory) => {
    setEditingId(memory.id);
    setEditContent(memory.content);
    setEditCategory(memory.category);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditContent('');
    setEditCategory('fact');
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    try {
      await api.memories.update(editingId, {
        content: editContent,
        category: editCategory,
      });
      setEditingId(null);
      fetchMemories(search || undefined);
    } catch {
      console.error('Failed to update memory');
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Memory</h1>
          <p className="text-muted-foreground">
            Long-term memories the AI agent has stored for this channel.
          </p>
        </div>
      </div>

      <div className="mb-4">
        <Input
          type="search"
          placeholder="Search memories..."
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="text-muted-foreground">Loading...</div>
      ) : memories.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            {search
              ? 'No memories match your search.'
              : 'No memories stored yet. The AI agent will save important facts during conversations.'}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {memories.map((memory) => (
            <Card key={memory.id}>
              <CardContent className="pt-6">
                {editingId === memory.id ? (
                  <div className="space-y-4">
                    <Textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      placeholder="Memory content..."
                      rows={3}
                    />
                    <Select
                      value={editCategory}
                      onValueChange={(v) => setEditCategory(v as MemoryCategory)}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CATEGORIES.map((cat) => (
                          <SelectItem key={cat.value} value={cat.value}>
                            {cat.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex gap-2">
                      <Button onClick={handleSaveEdit}>Save</Button>
                      <Button variant="outline" onClick={handleCancelEdit}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge
                          variant="secondary"
                          className={
                            CATEGORY_COLORS[memory.category] ?? 'bg-muted text-muted-foreground'
                          }
                        >
                          {memory.category}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          recalled {memory.recallCount} times
                        </span>
                      </div>
                      <p className="text-sm">{memory.content}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Created {new Date(memory.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button variant="ghost" size="sm" onClick={() => handleEdit(memory)}>
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-500 hover:text-red-700 hover:bg-red-500/10"
                        onClick={() => setDeleteTarget({ id: memory.id, content: memory.content })}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete Memory"
        description={`Are you sure you want to delete this memory? "${deleteTarget?.content.slice(0, 80)}${(deleteTarget?.content.length ?? 0) > 80 ? '...' : ''}" This action cannot be undone.`}
        onConfirm={() => {
          if (deleteTarget) handleDelete(deleteTarget.id);
        }}
      />
    </div>
  );
}
