import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { and, eq, isNull } from 'drizzle-orm';
import { createDb } from './index';
import { mcpConfigs } from './schema';

dotenv.config({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env'),
});

const GLOBAL_MCP_SERVERS = [
  {
    serverName: 'sequential-thinking',
    transportType: 'stdio' as const,
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
  },
];

async function seed() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }

  const db = createDb(url);

  console.log('Seeding global MCP configs...\n');

  for (const server of GLOBAL_MCP_SERVERS) {
    const existing = await db
      .select({ id: mcpConfigs.id })
      .from(mcpConfigs)
      .where(and(isNull(mcpConfigs.channelId), eq(mcpConfigs.serverName, server.serverName)))
      .limit(1);

    if (existing.length > 0) {
      console.log(`  SKIP  ${server.serverName} (already exists)`);
      continue;
    }

    await db.insert(mcpConfigs).values({
      channelId: null,
      serverName: server.serverName,
      transportType: server.transportType,
      command: server.command,
      args: server.args,
      enabled: true,
    });

    console.log(`  ADD   ${server.serverName}`);
  }

  console.log('\nSeed complete.');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
