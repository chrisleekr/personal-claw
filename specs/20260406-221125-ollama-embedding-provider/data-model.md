# Data Model: Ollama Embedding Provider

**Feature**: 20260406-221125-ollama-embedding-provider
**Date**: 2026-04-06

## Entity Changes

### No new entities or schema changes required

This feature does not modify the database schema. The existing `channel_memories.embedding` column (`vector(1024)`) and HNSW index are provider-agnostic — they store embedding vectors regardless of which provider generated them.

## Type Changes

### `EmbeddingProvider` type (in `apps/api/src/memory/embeddings.ts`)

**Current**:
```typescript
type EmbeddingProvider = 'openai' | 'bedrock';
```

**Updated**:
```typescript
type EmbeddingProvider = 'openai' | 'bedrock' | 'ollama';
```

### Configuration (`apps/api/src/config/index.ts`)

No new env vars. The existing `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, and `OLLAMA_BASE_URL` env vars are sufficient:

| Env Var | Purpose | Change |
|---------|---------|--------|
| `EMBEDDING_PROVIDER` | Select provider (`openai`, `bedrock`, `ollama`) | Accept `'ollama'` value |
| `EMBEDDING_MODEL` | Override default model for any provider | No change — works for Ollama too |
| `OLLAMA_BASE_URL` | Ollama server URL | No change — already exists for LLM |

## State Transitions

N/A — Embedding generation is a stateless operation. No lifecycle or state machine involved.

## Validation Rules

- `EMBEDDING_PROVIDER=ollama` works with or without `OLLAMA_BASE_URL` — when unset, defaults to `http://localhost:11434/api`. If Ollama is unreachable, graceful degradation applies (FR-006)
- Embedding vectors must be exactly 1024 dimensions (enforced by pgvector column constraint)
- If the Ollama model cannot produce 1024-dimension vectors, the embedding generation fails and triggers graceful degradation
