import { getLogger } from '@logtape/logtape';
import { channelMemories, channels, count, eq, skills } from '@personalclaw/db';
import { ADMIN_COMMANDS, SLASH_COMMANDS } from '@personalclaw/shared';
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
  userId: string;
  say: SayFn;
}

/**
 * Checks if a user is a channel admin. If the channel has no admins yet,
 * auto-assigns the requesting user as the first admin.
 * @returns true if the user is (or was just made) an admin.
 */
async function checkAdmin(
  resolvedChannelId: string,
  userId: string,
): Promise<{ isAdmin: boolean; admins: string[] }> {
  const db = getDb();
  const [channel] = await db
    .select({ channelAdmins: channels.channelAdmins })
    .from(channels)
    .where(eq(channels.id, resolvedChannelId));

  let admins = channel?.channelAdmins ?? [];

  // Auto-assign first user as admin if no admins configured
  if (admins.length === 0) {
    admins = [userId];
    await db
      .update(channels)
      .set({ channelAdmins: admins, updatedAt: new Date() })
      .where(eq(channels.id, resolvedChannelId));
    logger.info('Auto-assigned first channel admin', {
      channelId: resolvedChannelId,
      userId,
    });
  }

  return { isAdmin: admins.includes(userId), admins };
}

export async function handleSlashCommand({
  text,
  threadTs,
  channelId: slackChannelId,
  userId,
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

  // Permission check for admin commands
  if (ADMIN_COMMANDS.has(command)) {
    const { isAdmin, admins } = await checkAdmin(resolvedChannelId, userId);
    if (!isAdmin) {
      logger.info('Slash command denied: user not admin', {
        command,
        userId,
        channelId: resolvedChannelId,
      });
      const adminMentions = admins.map((a) => `<@${a}>`).join(', ');
      await say({
        text: `:lock: Sorry, only channel admins can use \`/pclaw ${command}\`. Current admins: ${adminMentions}.\nUse \`/pclaw admin list\` to see who has admin access.`,
        thread_ts: threadTs,
      });
      return;
    }
  }

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

    case 'admin': {
      const subcommand = args[0];
      const targetUser = args[1];

      if (subcommand === 'list') {
        const { admins } = await checkAdmin(resolvedChannelId, userId);
        const list = admins.map((a) => `• <@${a}>`).join('\n');
        await say({ text: `*Channel admins:*\n${list}`, thread_ts: threadTs });
        break;
      }

      // add/remove require admin
      const { isAdmin, admins } = await checkAdmin(resolvedChannelId, userId);
      if (!isAdmin) {
        await say({
          text: ':lock: Only admins can manage admin access.',
          thread_ts: threadTs,
        });
        break;
      }

      if (subcommand === 'add' && targetUser) {
        const cleanId = targetUser.replace(/^<@|>$/g, '');
        if (admins.includes(cleanId)) {
          await say({ text: `<@${cleanId}> is already an admin.`, thread_ts: threadTs });
        } else {
          const updated = [...admins, cleanId];
          await db
            .update(channels)
            .set({ channelAdmins: updated, updatedAt: new Date() })
            .where(eq(channels.id, resolvedChannelId));
          await say({
            text: `:white_check_mark: Added <@${cleanId}> as admin.`,
            thread_ts: threadTs,
          });
        }
      } else if (subcommand === 'remove' && targetUser) {
        const cleanId = targetUser.replace(/^<@|>$/g, '');
        const updated = admins.filter((a) => a !== cleanId);
        if (updated.length === 0) {
          await say({
            text: ':warning: Cannot remove the last admin.',
            thread_ts: threadTs,
          });
        } else {
          await db
            .update(channels)
            .set({ channelAdmins: updated, updatedAt: new Date() })
            .where(eq(channels.id, resolvedChannelId));
          await say({
            text: `:white_check_mark: Removed <@${cleanId}> from admins.`,
            thread_ts: threadTs,
          });
        }
      } else {
        await say({
          text: 'Usage: `/pclaw admin list`, `/pclaw admin add @user`, `/pclaw admin remove @user`',
          thread_ts: threadTs,
        });
      }
      break;
    }

    default:
      await say({
        text: `Unknown command: \`${command}\`. Try \`/pclaw help\`.`,
        thread_ts: threadTs,
      });
  }
}
