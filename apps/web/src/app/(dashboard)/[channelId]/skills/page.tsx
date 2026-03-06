'use client';

import type { Skill } from '@personalclaw/shared';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useConfigUpdates } from '@/hooks/use-config-updates';
import { api } from '@/lib/api-client';

export default function SkillsPage() {
  const params = useParams<{ channelId: string }>();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillStats, setSkillStats] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [formName, setFormName] = useState('');
  const [formContent, setFormContent] = useState('');
  const [formEnabled, setFormEnabled] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const fetchSkills = useCallback(async () => {
    try {
      setLoading(true);
      const [skillsRes, statsRes] = await Promise.all([
        api.skills.list(params.channelId),
        api.skillStats.get(params.channelId),
      ]);
      setSkills(skillsRes.data);
      const statsMap: Record<string, number> = {};
      for (const stat of statsRes.data) {
        statsMap[stat.skillId] = stat.usageCount;
      }
      setSkillStats(statsMap);
    } catch {
      console.error('Failed to fetch skills');
    } finally {
      setLoading(false);
    }
  }, [params.channelId]);

  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

  useConfigUpdates(params.channelId, (e) => {
    if (e.changeType === 'skills') fetchSkills();
  });

  const resetForm = () => {
    setFormName('');
    setFormContent('');
    setFormEnabled(true);
    setEditingSkill(null);
    setShowForm(false);
  };

  const handleSubmit = async () => {
    try {
      if (editingSkill) {
        await api.skills.update(editingSkill.id, {
          name: formName,
          content: formContent,
          enabled: formEnabled,
        });
      } else {
        await api.skills.create({
          channelId: params.channelId,
          name: formName,
          content: formContent,
          enabled: formEnabled,
        });
      }
      resetForm();
      fetchSkills();
    } catch {
      console.error('Failed to save skill');
    }
  };

  const handleEdit = (skill: Skill) => {
    setEditingSkill(skill);
    setFormName(skill.name);
    setFormContent(skill.content);
    setFormEnabled(skill.enabled);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    try {
      await api.skills.delete(id);
      fetchSkills();
    } catch {
      console.error('Failed to delete skill');
    }
  };

  const confirmDelete = (skill: Skill) => {
    setDeleteTarget({ id: skill.id, name: skill.name });
  };

  if (loading) {
    return <div className="text-muted-foreground">Loading...</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Skills</h1>
          <p className="text-muted-foreground">
            Manage reusable instruction sets for the AI agent.
          </p>
        </div>
        <Button
          type="button"
          onClick={() => {
            resetForm();
            setShowForm(true);
          }}
        >
          Add Skill
        </Button>
      </div>

      <Dialog
        open={showForm}
        onOpenChange={(open) => {
          setShowForm(open);
          if (!open) resetForm();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingSkill ? 'Edit Skill' : 'New Skill'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="skill-name">Skill name</Label>
              <Input
                id="skill-name"
                placeholder="Skill name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="skill-content">Skill content</Label>
              <Textarea
                id="skill-content"
                placeholder="Skill content (markdown instructions)..."
                value={formContent}
                onChange={(e) => setFormContent(e.target.value)}
                className="min-h-24"
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="skill-enabled"
                checked={formEnabled}
                onCheckedChange={(checked) => setFormEnabled(checked === true)}
              />
              <Label htmlFor="skill-enabled" className="font-normal cursor-pointer">
                Enabled
              </Label>
            </div>
            <div className="flex gap-2">
              <Button type="button" onClick={handleSubmit}>
                {editingSkill ? 'Update' : 'Create'}
              </Button>
              <Button type="button" variant="outline" onClick={resetForm}>
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {skills.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No skills configured. Click &quot;Add Skill&quot; to create one.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {skills.map((skill) => {
            const usageCount = skillStats[skill.id] ?? 0;
            return (
              <Card key={skill.id}>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold">{skill.name}</h3>
                      <Badge variant={skill.enabled ? 'default' : 'secondary'}>
                        {skill.enabled ? 'Active' : 'Disabled'}
                      </Badge>
                      {usageCount > 0 ? (
                        <Badge variant="outline">Used {usageCount} times</Badge>
                      ) : (
                        <Badge variant="secondary">Unused</Badge>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleEdit(skill)}
                      >
                        Edit
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => confirmDelete(skill)}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground line-clamp-2">{skill.content}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete Skill"
        description={`Are you sure you want to delete "${deleteTarget?.name}"? This action cannot be undone.`}
        onConfirm={() => {
          if (deleteTarget) handleDelete(deleteTarget.id);
        }}
      />
    </div>
  );
}
