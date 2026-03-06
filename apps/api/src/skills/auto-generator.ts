import { getLogger } from '@logtape/logtape';
import { eq, skills, sql, workflowPatterns } from '@personalclaw/db';
import {
  SKILL_AUTO_GEN_MIN_OCCURRENCES,
  SKILL_AUTO_GEN_MIN_SUCCESS_RATE,
} from '@personalclaw/shared';
import { generateText } from 'ai';
import { getProvider } from '../agent/provider';
import { getDb } from '../db';
import { errorDetails } from '../utils/error-fmt';

const logger = getLogger(['personalclaw', 'skills', 'auto']);

export class SkillAutoGenerator {
  async trackPattern(channelId: string, toolSequence: string[], success: boolean): Promise<void> {
    if (toolSequence.length < 2) return;

    const hash = this.hashSequence(toolSequence);
    const db = getDb();

    try {
      await db
        .insert(workflowPatterns)
        .values({
          channelId,
          patternHash: hash,
          toolSequence,
          occurrenceCount: 1,
          successCount: success ? 1 : 0,
          lastSeenAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [workflowPatterns.channelId, workflowPatterns.patternHash],
          set: {
            occurrenceCount: sql`${workflowPatterns.occurrenceCount} + 1`,
            successCount: success
              ? sql`${workflowPatterns.successCount} + 1`
              : workflowPatterns.successCount,
            lastSeenAt: new Date(),
          },
        });
    } catch (error) {
      logger.error('Failed to track pattern', { channelId, ...errorDetails(error) });
    }
  }

  async checkForGeneration(channelId: string): Promise<void> {
    const db = getDb();

    try {
      const candidates = await db
        .select()
        .from(workflowPatterns)
        .where(eq(workflowPatterns.channelId, channelId));

      const eligible = candidates.filter(
        (p) =>
          p.occurrenceCount >= SKILL_AUTO_GEN_MIN_OCCURRENCES &&
          p.successCount / p.occurrenceCount >= SKILL_AUTO_GEN_MIN_SUCCESS_RATE &&
          p.generatedSkillId === null,
      );

      for (const pattern of eligible) {
        await this.generateSkillDraft(channelId, pattern);
      }
    } catch (error) {
      logger.error('Failed to check for skill generation', { channelId, ...errorDetails(error) });
    }
  }

  private async generateSkillDraft(
    channelId: string,
    pattern: { id: string; toolSequence: string[]; description: string | null },
  ): Promise<void> {
    const { provider, model } = await getProvider(channelId);

    const result = await generateText({
      model: provider(model),
      prompt: `You are a skill author. Given this frequently-used tool sequence: ${pattern.toolSequence.join(' -> ')}
${pattern.description ? `Context: ${pattern.description}` : ''}

Write a concise, reusable skill instruction in Markdown that combines these tool calls into a single workflow.
The skill should describe when to use it, what steps to follow, and what tools to call.
Keep it under 500 words.`,
      stopWhen: (await import('ai')).stepCountIs(1),
    });

    const skillContent = result.text;
    if (!skillContent) return;

    const db = getDb();
    const skillName = `Auto: ${pattern.toolSequence.slice(0, 3).join(' + ')}`;

    const [newSkill] = await db
      .insert(skills)
      .values({
        channelId,
        name: skillName,
        content: skillContent,
        enabled: false,
      })
      .returning();

    if (newSkill) {
      await db
        .update(workflowPatterns)
        .set({ generatedSkillId: newSkill.id })
        .where(eq(workflowPatterns.id, pattern.id));

      logger.info`Generated draft skill "${skillName}" for channel=${channelId}`;
    }
  }

  private hashSequence(toolSequence: string[]): string {
    const str = toolSequence.join('|');
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0;
    }
    return hash.toString(36);
  }
}
