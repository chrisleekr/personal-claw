# Quickstart: Ollama Embedding Provider

**Feature**: 20260406-221125-ollama-embedding-provider
**Date**: 2026-04-06

## Prerequisites

1. Ollama installed and running locally
2. An embedding model pulled: `ollama pull mxbai-embed-large`

## Configuration

Set these env vars in `.env`:

```env
EMBEDDING_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434/api
# Optional: override model
# EMBEDDING_MODEL=snowflake-arctic-embed
```

## Files to Modify

| File | Change |
|------|--------|
| `apps/api/src/memory/embeddings.ts` | Add `'ollama'` to `EmbeddingProvider` type; add Ollama branch in `getEmbeddingProvider()` and `generateEmbedding()` |
| `apps/api/src/config/index.ts` | No changes needed — existing env vars are sufficient |
| `.env.example` | Update comments to document `ollama` as valid `EMBEDDING_PROVIDER` value |
| `apps/api/src/memory/__tests__/embeddings.test.ts` | Add unit tests for Ollama embedding path |

## Implementation Pattern

Follow the existing pattern in `embeddings.ts`. The Ollama branch mirrors OpenAI/Bedrock:

```typescript
// In generateEmbedding():
if (provider === 'ollama') {
  const ollama = createOllama({ baseURL: config.OLLAMA_BASE_URL ?? 'http://localhost:11434/api' });
  const { embedding } = await embed({
    model: ollama.embedding(modelOverride ?? DEFAULT_OLLAMA_EMBEDDING_MODEL),
    value: text,
  });
  return embedding;
}
```

## Verification

1. Start Ollama: `ollama serve`
2. Pull model: `ollama pull mxbai-embed-large`
3. Set `EMBEDDING_PROVIDER=ollama` in `.env`
4. Run the API: `bun run dev`
5. Save a memory through any channel — verify embedding is stored in `channel_memories`
6. Search for the memory — verify semantic search returns results

## Run Tests

```bash
bun test apps/api/src/memory/__tests__/embeddings.test.ts
```
