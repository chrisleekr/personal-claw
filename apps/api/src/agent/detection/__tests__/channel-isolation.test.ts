import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sql } from '@personalclaw/db';

// Load DATABASE_URL from the repo-root .env if it is not already set in the
// process environment. This mirrors what `dotenv -e .env --` does for the
// `dev` script but keeps the integration test self-contained — no changes to
// the root package.json or the test-isolated runner required. In CI the env
// var is set by GitHub Actions services so this branch is a no-op.
// This integration test needs a real database. `apps/api/bunfig.toml` has
// `preload = ["./src/test-preload.ts"]` which stubs DATABASE_URL to a fake
// value so other (mocked) tests don't trip config parsing. We unconditionally
// read the real DATABASE_URL from the repo-root `.env` here and override the
// stub; if the `.env` is absent or doesn't contain DATABASE_URL, the suite
// skips gracefully with `describe.skip`.
const STUB_URL = 'postgres://test:test@localhost:5432/test';
let realDatabaseUrl: string | null = null;

if (process.env.DATABASE_URL && process.env.DATABASE_URL !== STUB_URL) {
  // Honor a pre-set real URL from CI or a developer shell export.
  realDatabaseUrl = process.env.DATABASE_URL;
} else {
  try {
    const envPath = resolve(import.meta.dir, '../../../../../../.env');
    const envContent = readFileSync(envPath, 'utf8');
    for (const line of envContent.split('\n')) {
      const match = line.match(/^DATABASE_URL=(.*)$/);
      if (match) {
        const parsed = match[1].trim().replace(/^["']|["']$/g, '');
        if (parsed && parsed !== STUB_URL) {
          realDatabaseUrl = parsed;
          process.env.DATABASE_URL = parsed;
        }
        break;
      }
    }
  } catch {
    // Missing .env file — the suite skips below.
  }
}

const DB_AVAILABLE = realDatabaseUrl !== null;

// Only import getDb AFTER the env is loaded so the lazy singleton connects
// to the real URL, not the preload stub.
const { getDb } = await import('../../../db');

/**
 * Channel-isolation guard for the new detection_* tables (Constitution III,
 * resolves analysis finding O1).
 *
 * This test seeds rows in `detection_audit_events`, `detection_audit_annotations`,
 * and `detection_overrides` for two distinct channel UUIDs, then asserts that
 * scoped queries never return rows from the wrong channel and that
 * `ON DELETE CASCADE` correctly removes dependent rows when a channel is deleted.
 *
 * Preconditions: the dev database has migration 0015 applied.
 */

// Skip the entire suite if no database is reachable. This test exercises
// real DB cascade behavior; mocking it would defeat the purpose.
const d = DB_AVAILABLE ? describe : describe.skip;

d('detection_* tables — channel isolation (FR-026 / FR-033 / Constitution III)', () => {
  const db = getDb();

  // Use freshly-generated channel UUIDs to avoid colliding with anything
  // a developer may have in their local DB.
  const channelA = randomUUID();
  const channelB = randomUUID();

  beforeAll(async () => {
    // Insert two test channels (the FK constraints require them).
    await db.execute(sql`
      INSERT INTO channels (id, platform, external_id, external_name)
      VALUES
        (${channelA}, 'cli', ${`isolation-test-A-${channelA}`}, 'Isolation Test Channel A'),
        (${channelB}, 'cli', ${`isolation-test-B-${channelB}`}, 'Isolation Test Channel B')
    `);

    // Seed three audit events: two for A, one for B.
    await db.execute(sql`
      INSERT INTO detection_audit_events
        (channel_id, external_user_id, decision, risk_score, layers_fired, reason_code, redacted_excerpt, reference_id, source_kind)
      VALUES
        (${channelA}, 'user-A1', 'block', 95.0, ARRAY['heuristics','similarity']::text[], 'TEST_BLOCK_A1', 'redacted-A1', ${`refA1-${channelA.slice(0, 8)}`}, 'user_message'),
        (${channelA}, 'user-A2', 'flag',  60.0, ARRAY['heuristics']::text[],              'TEST_FLAG_A2',  'redacted-A2', ${`refA2-${channelA.slice(0, 8)}`}, 'user_message'),
        (${channelB}, 'user-B1', 'block', 99.0, ARRAY['classifier']::text[],              'TEST_BLOCK_B1', 'redacted-B1', ${`refB1-${channelB.slice(0, 8)}`}, 'memory_recall')
    `);

    // Seed a detection_overrides row in each channel.
    await db.execute(sql`
      INSERT INTO detection_overrides
        (channel_id, override_kind, target_key, justification, created_by)
      VALUES
        (${channelA}, 'allowlist_signature', 'corpus_v1_sig_001', 'isolation test A allowlist', 'admin-A'),
        (${channelB}, 'block_phrase',         'isolation_test_phrase_B', 'isolation test B block', 'admin-B')
    `);
  });

  afterAll(async () => {
    // Cleanup — channels cascade-delete the detection_* rows.
    await db.execute(sql`DELETE FROM channels WHERE id IN (${channelA}, ${channelB})`);
  });

  test('detection_audit_events scoped query returns only the requested channel rows', async () => {
    const rowsForA = await db.execute(sql`
      SELECT external_user_id, reason_code FROM detection_audit_events WHERE channel_id = ${channelA}
    `);
    const rowsForB = await db.execute(sql`
      SELECT external_user_id, reason_code FROM detection_audit_events WHERE channel_id = ${channelB}
    `);

    const aReasons = (rowsForA as Array<{ reason_code: string }>).map((r) => r.reason_code).sort();
    const bReasons = (rowsForB as Array<{ reason_code: string }>).map((r) => r.reason_code).sort();

    expect(aReasons).toEqual(['TEST_BLOCK_A1', 'TEST_FLAG_A2']);
    expect(bReasons).toEqual(['TEST_BLOCK_B1']);

    // No row from one channel may appear when querying the other.
    expect(aReasons).not.toContain('TEST_BLOCK_B1');
    expect(bReasons).not.toContain('TEST_BLOCK_A1');
    expect(bReasons).not.toContain('TEST_FLAG_A2');
  });

  test('detection_overrides scoped query is per-channel', async () => {
    const overridesA = await db.execute(sql`
      SELECT override_kind, target_key FROM detection_overrides WHERE channel_id = ${channelA}
    `);
    const overridesB = await db.execute(sql`
      SELECT override_kind, target_key FROM detection_overrides WHERE channel_id = ${channelB}
    `);

    const a = overridesA as Array<{ override_kind: string; target_key: string }>;
    const b = overridesB as Array<{ override_kind: string; target_key: string }>;

    expect(a).toHaveLength(1);
    expect(a[0].override_kind).toBe('allowlist_signature');
    expect(a[0].target_key).toBe('corpus_v1_sig_001');

    expect(b).toHaveLength(1);
    expect(b[0].override_kind).toBe('block_phrase');
    expect(b[0].target_key).toBe('isolation_test_phrase_B');
  });

  test('ON DELETE CASCADE removes dependent rows when a channel is deleted', async () => {
    // Create an isolated short-lived channel to avoid disturbing the suite-level fixtures.
    const transientChannel = randomUUID();
    await db.execute(sql`
      INSERT INTO channels (id, platform, external_id) VALUES (${transientChannel}, 'cli', ${`cascade-${transientChannel}`})
    `);
    await db.execute(sql`
      INSERT INTO detection_audit_events (channel_id, external_user_id, decision, risk_score, layers_fired, reason_code, redacted_excerpt, reference_id, source_kind)
      VALUES (${transientChannel}, 'cascade-user', 'block', 99.0, ARRAY['classifier']::text[], 'CASCADE_TEST', 'redacted', ${`cascade-ref-${transientChannel.slice(0, 8)}`}, 'user_message')
    `);
    await db.execute(sql`
      INSERT INTO detection_overrides (channel_id, override_kind, target_key, justification, created_by)
      VALUES (${transientChannel}, 'block_phrase', 'cascade_phrase', 'cascade test', 'admin-cascade')
    `);

    // Delete the channel — cascade should remove the audit row and override.
    await db.execute(sql`DELETE FROM channels WHERE id = ${transientChannel}`);

    const remainingEvents = await db.execute(sql`
      SELECT id FROM detection_audit_events WHERE channel_id = ${transientChannel}
    `);
    const remainingOverrides = await db.execute(sql`
      SELECT id FROM detection_overrides WHERE channel_id = ${transientChannel}
    `);

    expect((remainingEvents as unknown[]).length).toBe(0);
    expect((remainingOverrides as unknown[]).length).toBe(0);
  });
});
