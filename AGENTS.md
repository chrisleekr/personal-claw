# PersonalClaw -- Agent Guidelines

## Project Overview

PersonalClaw is a multi-channel AI agent with a web dashboard. Turborepo monorepo with Bun runtime. See `.cursor/rules/project-overview.mdc` for monorepo structure and key conventions.

## Architecture Rules

- All database access goes through `packages/db` -- never import `pg`, `postgres`, or `drizzle-orm` directly in apps
- All shared types live in `packages/shared` -- never duplicate type definitions across apps
- Backend communicates with frontend via Hono REST API -- no direct DB imports in `apps/web`
- Agent engine is provider-agnostic -- use Vercel AI SDK abstractions (`ai` package), never import `@anthropic-ai/sdk` directly
- MCP server configs are database-driven -- never hardcode MCP server URLs or stdio commands
- Channel isolation is mandatory -- every DB query must be scoped by `channel_id`
- Memory operations must go through the memory engine -- never query `channel_memories` or `conversations` tables directly from routes or handlers

## Code Style

- TypeScript strict mode, no `any` types
- Use Zod for all runtime validation
- Prefer named exports over default exports (exception: Next.js pages/layouts)

See `.cursor/rules/typescript-standards.mdc` for full reference.

## Logging

- Use LogTape (`@logtape/logtape`) for all backend logging -- never use `console.*` in `apps/api`
- Use `withContext()` for request-scoped data (channelId, requestId)

See `.cursor/rules/logging.mdc` for full reference.

## File Conventions

- One primary export per file for major modules (engine.ts, manager.ts, loader.ts)
- Place tests in `__tests__` subfolders: `foo.ts` -> `__tests__/foo.test.ts`
- Use barrel exports (`index.ts`) only at package boundaries (`packages/*/src/index.ts`), not within apps
- Route files go in `apps/api/src/routes/` and follow the pattern: export a `Hono` instance

## Database

- All schema changes go through Drizzle migrations -- never use raw SQL in application code (except for pgvector/tsvector operations)
- All tables must have `created_at` and `updated_at` columns

See `.cursor/rules/drizzle-schema.mdc` for full reference.

## API Patterns

- Validate all inputs with Zod schemas from `@personalclaw/shared`
- Return consistent JSON: `{ data }` for success, `{ error, message }` for failures

See `.cursor/rules/hono-backend.mdc` for full reference.

## Channel Integration

- Always extract `channel_id`, `user_id`, `thread_id` from platform event context
- Always acquire thread lock before agent execution to prevent race conditions
- Always log cost after every `generateText` / `streamText` call
- Always include `external_user_id` in logs, conversations, and usage records (user attribution)
- Emit lifecycle hooks at correct points: `message:received`, `tool:called`, `memory:saved`, `message:sending`, `message:sent`

## Testing

- Use Bun's built-in test runner (`bun test`)
- Unit tests for pure functions (compaction, cost calculation, prompt composition)
- Integration tests for API routes (use Hono's test client)
- Mock external services (Slack API, Anthropic API, MCP servers) in tests
- Test channel isolation: verify queries never leak data across channels

## Git

- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`
- One logical change per commit
- Never commit `.env` files or secrets
