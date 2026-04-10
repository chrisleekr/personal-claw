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
import { initDetectionCorpus } from './agent/detection/corpus-init';
import { shutdownEngine } from './agent/engine';
import { closeBrowserPool } from './browser/engine';
import { initAuditCleanup } from './cron/audit-cleanup';
import { initLogger } from './logger';
import { initMemoryDecay } from './memory/decay';
import { authMiddleware } from './middleware/auth';
import { requestBodyLogger } from './middleware/request-logger';
import { PlatformRegistry } from './platforms/registry';
import { slackPlugin } from './platforms/slack/plugin';
import { approvalsRoute } from './routes/approvals';
import { channelsRoute } from './routes/channels';
import { conversationsRoute } from './routes/conversations';
import { detectionAuditCleanupRoute, detectionAuditRoute } from './routes/detection-audit';
import { detectionOverridesRoute } from './routes/detection-overrides';
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
// FR-033 per-channel detection overrides — mounted at /api/channels so the
// final paths resolve to /api/channels/:channelId/detection-overrides[/:id].
// The sub-router uses 2-segment path patterns that do not collide with
// channelsRoute's single-segment /:id patterns, so Hono's sequential
// matcher resolves each request to the correct handler.
app.route('/api/channels', detectionOverridesRoute);
// FR-015 per-channel detection audit admin endpoints. Same mount rationale
// as detection-overrides: 2-segment patterns under /api/channels. Final
// paths: /api/channels/:channelId/detection-audit/recent,
// /api/channels/:channelId/detection-audit/by-reference/:referenceId,
// /api/channels/:channelId/detection-audit/:auditEventId/annotate.
app.route('/api/channels', detectionAuditRoute);
// FR-028 admin-triggered retention cleanup. Separate mount because the
// path prefix is /api/guardrails/audit/*, not /api/channels/*.
app.route('/api/guardrails/audit', detectionAuditCleanupRoute);
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
  // FR-032 / research.md R5: generate and cache embeddings for the committed
  // attack corpus. Per R10 this is fail-closed — on any error we throw and
  // the top-level main().catch() logs fatal and exits. A detection pipeline
  // without its base corpus is a silent security weakening.
  await initDetectionCorpus();
  // FR-022 / FR-028: register the daily retention cleanup cron for the
  // detection_audit_events table. Placed AFTER initDetectionCorpus so the
  // corpus is loaded before the cleanup routine could touch audit events
  // on the very first sweep. Idempotent — calling twice stops the previous
  // task before registering the new one.
  initAuditCleanup();
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
