# personal-claw Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-04-07

## Active Technologies
- TypeScript 5.7+ (strict mode, zero `any`) + Bun 1.3.9 + Hono (API), `ai` (Vercel AI SDK v6), `ollama-ai-provider-v2` v3.3.1 (already installed) (20260406-221125-ollama-embedding-provider)
- PostgreSQL with pgvector (1024-dimension embeddings, HNSW index) (20260406-221125-ollama-embedding-provider)
- TypeScript 5.7+ (strict mode, zero `any`) + Bun 1.3.9 (runtime), Hono (API), LogTape (logging), Zod (validation), `@personalclaw/shared` (types, schemas, MCP security) (20260407-184402-fix-sandbox-cmd-bypass)
- N/A (no database changes - config defaults change in code only) (20260407-184402-fix-sandbox-cmd-bypass)

- TypeScript 5.7+ (strict mode, zero `any`) + Bun 1.3.9 (runtime + test runner), Hono (API framework), LogTape (logging) (20260406-201317-sandbox-env-allowlist)

## Project Structure

```text
apps/api/       — Hono backend (port 4000), agent engine, platform adapters
apps/web/       — Next.js 15 App Router frontend, Auth.js, shadcn/ui
packages/db/    — Drizzle ORM schema, migrations, seed, database access
packages/shared/ — TypeScript types, Zod schemas, constants, MCP security
```

## Commands

bun run check

## Code Style

TypeScript 5.7+ (strict mode, zero `any`): Follow standard conventions

## Recent Changes
- 20260407-184402-fix-sandbox-cmd-bypass: Added TypeScript 5.7+ (strict mode, zero `any`) + Bun 1.3.9 (runtime), Hono (API), LogTape (logging), Zod (validation), `@personalclaw/shared` (types, schemas, MCP security)
- 20260406-221125-ollama-embedding-provider: Added TypeScript 5.7+ (strict mode, zero `any`) + Bun 1.3.9 + Hono (API), `ai` (Vercel AI SDK v6), `ollama-ai-provider-v2` v3.3.1 (already installed)


<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
