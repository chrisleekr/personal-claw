## Summary

Fixes three race conditions in the API service identified in issue #11:

1. **`MCPService.upsertToolPolicy`** — SELECT-then-INSERT/UPDATE could let two concurrent callers each insert a row for the same `(mcp_config_id, channel_id)` pair. Replaced with atomic `INSERT … ON CONFLICT DO UPDATE` backed by partial unique indexes (one for per-channel policies, one for global / null channel).
2. **`ConversationMemory.append`** — read-modify-write of the JSONB `messages` column dropped concurrent appends. Replaced with `INSERT … ON CONFLICT DO UPDATE SET messages = conversations.messages || EXCLUDED.messages` wrapped in `db.transaction()`, with a follow-up token-count recompute against the merged messages. Backed by a unique constraint on `(channel_id, external_thread_id)`.
3. **Rate-limiter middleware** — separate `INCR` and `EXPIRE` calls left a window where a crash between the two could leave a permanent key, and concurrent INCRs could both observe `count == 1` and re-set TTL. Replaced with a single `EVAL`'d Lua script that atomically increments and (re-)sets TTL on first hit, returning `[count, ttl]`.

Each migration includes a dedupe pre-step that collapses any existing duplicates (keeping the most recently updated/created row) so the constraint creation succeeds against historical data.

## Files changed

- `packages/db/src/migrations/0016_tool_policy_unique.sql` (new) — dedupe + two partial unique indexes on `tool_policies`.
- `packages/db/src/migrations/0017_conversations_unique_thread.sql` (new) — dedupe + unique constraint on `conversations(channel_id, external_thread_id)`.
- `packages/db/src/migrations/meta/0016_snapshot.json` (new), `0017_snapshot.json` (new), `_journal.json` — Drizzle migration metadata.
- `packages/db/src/schema/tool-policies.ts` — declared the two partial unique indexes.
- `packages/db/src/schema/conversations.ts` — declared the channel/thread unique constraint.
- `apps/api/src/services/mcp.service.ts` — atomic `upsertToolPolicy` branched on null vs non-null channelId, each branch using `targetWhere` matching its partial index.
- `apps/api/src/services/__tests__/mcp.service.test.ts` — assert no preceding SELECT and that `onConflictDoUpdate` is invoked.
- `apps/api/src/memory/conversation.ts` — `append` now wraps an upsert + follow-up token-count update inside `db.transaction()`.
- `apps/api/src/memory/__tests__/conversation.test.ts` — adds `transaction` mock + concurrent-append regression test.
- `apps/api/src/memory/__tests__/engine.test.ts` — adds `transaction` mock and `onConflictDoUpdate` chain to the mock db.
- `apps/api/src/middleware/rate-limiter.ts` — single Lua-script `redis.eval` returning `[count, ttl]`.
- `apps/api/src/middleware/__tests__/rate-limiter.test.ts` — replaces `incr/expire/ttl` mocks with `eval` mock; adds a Redis-failure fallback test.

## Commits

- `9e3235d` — `fix(api): atomic upsert for MCP tool policies (#11)`
- `d138d61` — `fix(api): atomic conversation append via transaction (#11)`
- `d4e52aa` — `fix(api): atomic rate-limit window via Redis Lua script (#11)`

## Tests run

- `bun run check` (turbo: `check-types`, `lint`, `test`).
  - `check-types`: ✅ all 4 packages pass.
  - `lint`: ✅ pass.
  - `test`: 114 passed, 1 failed. The single failing file is `apps/api/src/agent/detection/__tests__/channel-isolation.test.ts`, which requires a live Postgres (`relation "channels" does not exist` / auth failure depending on env). Verified pre-existing on `main` via baseline run before applying changes — not a regression introduced by this PR.
- Targeted run of all four touched test files (`mcp.service.test.ts`, `conversation.test.ts`, `engine.test.ts`, `rate-limiter.test.ts`): 50 passed, 0 failed.

## Verification

- **Tool policies**: the two partial unique indexes mean Postgres rejects a concurrent second insert for the same `(mcp_config_id, channel_id)` (or for the same global `mcp_config_id` with `channel_id IS NULL`); `ON CONFLICT DO UPDATE` then deterministically merges to the latest deny/allow lists.
- **Conversations**: the unique constraint and JSONB `||` mean a concurrent second `append` for the same `(channel_id, external_thread_id)` lands in the conflict branch and concatenates rather than overwriting; the follow-up token-count update inside the same transaction reflects the true merged total.
- **Rate-limiter**: the Lua script runs atomically inside Redis, so a crash mid-script is impossible from the client's perspective; the script also self-heals via `TTL < 0 → EXPIRE` if a prior run left a key without a TTL.
