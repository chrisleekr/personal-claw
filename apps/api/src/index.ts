import { honoLogger } from '@logtape/hono';
import { getLogger } from '@logtape/logtape';
import type { Server } from 'bun';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { config } from './config';
import { configWsHandler } from './config/hot-reload';
import { initHeartbeats } from './cron/heartbeat';
import { initCronRunner } from './cron/runner';
import { errorHandler } from './errors/error-handler';
import { consumeTicket } from './routes/ws-ticket';
import './hooks/builtin/audit-trail';
import './hooks/builtin/cost-log';
import { shutdownEngine } from './agent/engine';
import { closeBrowserPool } from './browser/engine';
import { initLogger } from './logger';
import { initMemoryDecay } from './memory/decay';
import { authMiddleware } from './middleware/auth';
import { requestBodyLogger } from './middleware/request-logger';
import { PlatformRegistry } from './platforms/registry';
import { slackPlugin } from './platforms/slack/plugin';
import { approvalsRoute } from './routes/approvals';
import { channelsRoute } from './routes/channels';
import { conversationsRoute } from './routes/conversations';
import { identityRoute } from './routes/identity';
import { mcpRoute } from './routes/mcp';
import { memoriesRoute } from './routes/memories';
import { schedulesRoute } from './routes/schedules';
import { skillStatsRoute } from './routes/skill-stats';
import { skillsRoute } from './routes/skills';
import { usageRoute } from './routes/usage';
import { wsTicketRoute } from './routes/ws-ticket';
import { errorDetails } from './utils/error-fmt';

const logger = getLogger(['personalclaw', 'server']);
const wsLogger = getLogger(['personalclaw', 'ws', 'auth']);

const app = new Hono();

app.onError(errorHandler);

app.use(
  '*',
  honoLogger({
    category: ['personalclaw', 'http'],
    format: config.NODE_ENV === 'production' ? 'combined' : 'dev',
    skip: (c) => c.req.path === '/health',
  }),
);
app.use('*', requestBodyLogger);
app.use(
  '*',
  cors({
    origin: config.AUTH_URL,
    credentials: true,
  }),
);

app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

app.use('/api/*', authMiddleware);

app.route('/api/channels', channelsRoute);
app.route('/api/skills', skillsRoute);
app.route('/api/skill-stats', skillStatsRoute);
app.route('/api/mcp', mcpRoute);
app.route('/api/schedules', schedulesRoute);
app.route('/api/identity', identityRoute);
app.route('/api/usage', usageRoute);
app.route('/api/memories', memoriesRoute);
app.route('/api/conversations', conversationsRoute);
app.route('/api/approvals', approvalsRoute);
app.route('/api/ws-ticket', wsTicketRoute);

const port = config.PORT;

async function main() {
  await initLogger();
  PlatformRegistry.register(slackPlugin);
  await PlatformRegistry.initAll();
  initCronRunner();
  initHeartbeats();
  initMemoryDecay();

  logger.info`PersonalClaw API running on port ${port}`;
}

main().catch((err) => {
  logger.fatal('Failed to start server', errorDetails(err));
});

let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info`Received ${signal}, shutting down gracefully...`;
  try {
    await PlatformRegistry.shutdownAll();
    await closeBrowserPool();
    await shutdownEngine();
  } catch (err) {
    logger.error('Error during shutdown', errorDetails(err));
  }
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default {
  port,
  fetch(req: Request, server: Server<unknown>) {
    const url = new URL(req.url);
    if (url.pathname === '/ws/config-updates') {
      const ticket = url.searchParams.get('ticket');
      if (!ticket || !consumeTicket(ticket)) {
        wsLogger.debug('WebSocket auth rejected: invalid or missing ticket', {
          hasTicket: !!ticket,
        });
        return new Response('Unauthorized', { status: 401 });
      }
      if (server.upgrade(req, { data: { connectedAt: Date.now() } })) return undefined;
      return new Response('WebSocket upgrade failed', { status: 400 });
    }
    return app.fetch(req, server);
  },
  websocket: configWsHandler,
  idleTimeout: 120,
};
