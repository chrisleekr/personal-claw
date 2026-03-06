import { getLogger } from '@logtape/logtape';
import { channelMemories, channels, count, eq, skills } from '@personalclaw/db';
import { SLASH_COMMANDS } from '@personalclaw/shared';
import type { SayFn } from '@slack/bolt';
import { listRegisteredModels } from '../../agent/pricing';
import { autoRegisterChannel } from '../../channels/auto-register';
import { ChannelNotFoundError, ChannelResolver } from '../../channels/resolver';
import { config } from '../../config';
import { getDb } from '../../db';
import { MemoryEngine } from '../../memory/engine';
import { errorDetails } from '../../utils/error-fmt';

const logger = getLogger(['personalclaw', 'slack', 'slash-commands']);

export interface SlashCommandParams {
  text: string;
  threadTs: string;
  channelId: string;
  say: SayFn;
}

export async function handleSlashCommand({
  text,
  threadTs,
  channelId: slackChannelId,
  say,
}: SlashCommandParams) {
  const parts = text.replace('/pclaw ', '').split(' ');
  const command = parts[0];
  const args = parts.slice(1);

  if (command === 'help') {
    await say({
      text: `Available commands:\n${SLASH_COMMANDS.map((c) => `• \`/pclaw ${c}\``).join('\n')}`,
      thread_ts: threadTs,
    });
    return;
  }

  const resolver = ChannelResolver.getInstance();
  let resolvedChannelId: string;
  try {
    const channel = await resolver.resolve('slack', slackChannelId);
    resolvedChannelId = channel.id;
  } catch (error) {
    if (error instanceof ChannelNotFoundError) {
      logger.info`Auto-registering Slack channel ${slackChannelId}`;
      const channel = await autoRegisterChannel('slack', slackChannelId);
      resolvedChannelId = channel.id;
    } else {
      throw error;
    }
  }

  const db = getDb();

  switch (command) {
    case 'status': {
      const [channel] = await db
        .select({ model: channels.model, provider: channels.provider })
        .from(channels)
        .where(eq(channels.id, resolvedChannelId));

      const [memoryCount] = await db
        .select({ count: count() })
        .from(channelMemories)
        .where(eq(channelMemories.channelId, resolvedChannelId));

      const [skillCount] = await db
        .select({ count: count() })
        .from(skills)
        .where(eq(skills.channelId, resolvedChannelId));

      await say({
        text: [
          `*Channel status:* active`,
          `*Model:* ${channel?.model ?? 'default'}`,
          `*Provider:* ${channel?.provider ?? 'anthropic'}`,
          `*Memories:* ${memoryCount?.count ?? 0}`,
          `*Skills:* ${skillCount?.count ?? 0}`,
        ].join('\n'),
        thread_ts: threadTs,
      });
      break;
    }

    case 'model': {
      if (args[0]) {
        const knownModels = listRegisteredModels();
        if (!knownModels.includes(args[0])) {
          await say({
            text: `:warning: Unknown model: \`${args[0]}\`\nAvailable models:\n${knownModels.map((m) => `• \`${m}\``).join('\n')}`,
            thread_ts: threadTs,
          });
          break;
        }
        try {
          await db
            .update(channels)
            .set({ model: args[0], updatedAt: new Date() })
            .where(eq(channels.id, resolvedChannelId));
          await say({ text: `Model updated to: \`${args[0]}\``, thread_ts: threadTs });
        } catch (error) {
          logger.error('Failed to update model', {
            channelId: resolvedChannelId,
            requestedModel: args[0],
            ...errorDetails(error),
          });
          await say({ text: 'Failed to update model.', thread_ts: threadTs });
        }
      } else {
        const [channel] = await db
          .select({ model: channels.model })
          .from(channels)
          .where(eq(channels.id, resolvedChannelId));
        await say({
          text: `Current model: \`${channel?.model ?? 'claude-sonnet-4-20250514'}\`\nUsage: \`/pclaw model <model-name>\``,
          thread_ts: threadTs,
        });
      }
      break;
    }

    case 'skills': {
      const rows = await db
        .select({ name: skills.name, enabled: skills.enabled })
        .from(skills)
        .where(eq(skills.channelId, resolvedChannelId));

      if (rows.length === 0) {
        await say({
          text: 'No skills configured. Add skills via the dashboard.',
          thread_ts: threadTs,
        });
      } else {
        const list = rows
          .map((r) => `• ${r.name} ${r.enabled ? '(active)' : '(disabled)'}`)
          .join('\n');
        await say({ text: `*Skills:*\n${list}`, thread_ts: threadTs });
      }
      break;
    }

    case 'memory': {
      const [memCount] = await db
        .select({ count: count() })
        .from(channelMemories)
        .where(eq(channelMemories.channelId, resolvedChannelId));

      await say({
        text: `Memory stats: ${memCount?.count ?? 0} long-term memories\nUse the dashboard to manage memories.`,
        thread_ts: threadTs,
      });
      break;
    }

    case 'compact': {
      try {
        const memoryEngine = new MemoryEngine();
        await say({ text: ':hourglass_flowing_sand: Compacting thread...', thread_ts: threadTs });
        await memoryEngine.triggerCompaction(resolvedChannelId, threadTs);
        await say({ text: ':white_check_mark: Thread compaction complete.', thread_ts: threadTs });
      } catch (error) {
        logger.error('Failed to compact thread', {
          channelId: resolvedChannelId,
          threadTs,
          ...errorDetails(error),
        });
        await say({ text: ':x: Failed to compact thread.', thread_ts: threadTs });
      }
      break;
    }

    case 'config': {
      const dashUrl = config.AUTH_URL;
      await say({
        text: `Configure this channel: ${dashUrl}/${resolvedChannelId}/identity`,
        thread_ts: threadTs,
      });
      break;
    }

    default:
      await say({
        text: `Unknown command: \`${command}\`. Try \`/pclaw help\`.`,
        thread_ts: threadTs,
      });
  }
}
