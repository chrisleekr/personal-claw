# Slack Bot Setup Guide

## Prerequisites

- A Slack workspace where you have admin permissions
- PersonalClaw API running (default: `http://localhost:4000`)

## Step-by-Step Setup

### 1. Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App**
3. Select **From scratch**
4. Set **App Name**: `PersonalClaw`
5. Select your workspace
6. Click **Create App**

### 2. Enable Socket Mode

Socket Mode allows the bot to connect without a public URL (ideal for local development).

1. Go to **Settings** > **Socket Mode**
2. Toggle **Enable Socket Mode** to ON
3. Create an **App-Level Token**:
   - Token Name: `personalclaw-socket`
   - Scope: `connections:write`
4. Click **Generate**
5. Copy the token (starts with `xapp-`)

### 3. Configure Bot Token Scopes

1. Go to **Features** > **OAuth & Permissions**
2. Under **Bot Token Scopes**, add:

| Scope | Purpose |
|-------|---------|
| `app_mentions:read` | Read @PersonalClaw mentions |
| `channels:history` | Read public channel messages |
| `channels:read` | List public channels |
| `chat:write` | Send messages |
| `files:read` | Read uploaded files (image processing) |
| `groups:history` | Read private channel messages |
| `groups:read` | List private channels |
| `users:read` | Look up user information |
| `reactions:write` | Add emoji reactions |

### 4. Enable Event Subscriptions

1. Go to **Features** > **Event Subscriptions**
2. Toggle **Enable Events** to ON
3. Under **Subscribe to bot events**, add:
   - `app_mention`
   - `message.channels`
   - `message.groups`

### 5. Enable Interactivity (for Approvals)

1. Go to **Features** > **Interactivity & Shortcuts**
2. Toggle **Interactivity** to ON
3. For Socket Mode, no Request URL is needed

### 6. Install App to Workspace

1. Go to **Settings** > **Install App**
2. Click **Install to Workspace**
3. Review and approve permissions
4. Copy the **Bot User OAuth Token** (starts with `xoxb-`)

### 7. Configure Environment Variables

Add these to your `.env` file:

```env
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token
SLACK_SIGNING_SECRET=your-signing-secret
```

Find the **Signing Secret** under **Settings** > **Basic Information** > **App Credentials**.

### 8. Invite Bot to Channels

In each Slack channel where you want PersonalClaw active:

```
/invite @PersonalClaw
```

When PersonalClaw joins a channel, it will auto-register the channel config in the database.

### 9. Test the Bot

1. Start the API server: `bun run dev` (from `apps/api`)
2. In Slack, mention the bot: `@PersonalClaw hello`
3. The bot should respond in the thread

## Slash Commands (Optional)

If you want native `/pclaw` slash commands instead of message-based commands:

1. Go to **Features** > **Slash Commands**
2. Click **Create New Command**:
   - Command: `/pclaw`
   - Short Description: `PersonalClaw agent commands`
   - Usage Hint: `help | status | model | skills | memory | compact | config`
3. For Socket Mode, the request URL is handled automatically

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Bot doesn't respond | Check SLACK_BOT_TOKEN and SLACK_APP_TOKEN in .env |
| "not_authed" error | Regenerate the Bot User OAuth Token |
| Bot only works in some channels | Make sure to `/invite @PersonalClaw` in each channel |
| No socket connection | Verify SLACK_APP_TOKEN starts with `xapp-` and Socket Mode is enabled |
| Interactive buttons don't work | Ensure Interactivity is enabled in the app settings |

## References

- [Slack Bolt.js Documentation](https://slack.dev/bolt-js/getting-started)
- [Slack API: Socket Mode](https://api.slack.com/apis/socket-mode)
- [Slack API: Event Subscriptions](https://api.slack.com/events-api)
