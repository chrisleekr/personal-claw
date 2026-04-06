# Contract: Embedding Provider Interface

**Feature**: 20260406-221125-ollama-embedding-provider
**Date**: 2026-04-06

## `generateEmbedding()` Function Contract

This is an internal module function, not an external API. The contract documents the expected behavior after adding Ollama support.

### Signature

```typescript
export async function generateEmbedding(text: string): Promise<number[]>
```

### Behavior by Provider

| Provider | Default Model | Dimensions | Provider Options Key |
|----------|---------------|------------|---------------------|
| `openai` | `text-embedding-3-small` | 1024 | `openai` |
| `bedrock` | `amazon.titan-embed-text-v2:0` | 1024 | `bedrock` |
| `ollama` (NEW) | `mxbai-embed-large` | 1024 | `ollama` |

### Provider Selection Logic

```
EMBEDDING_PROVIDER env var → getEmbeddingProvider()
  'bedrock' → bedrock
  'ollama'  → ollama
  anything else / undefined → openai (default)
```

### Error Behavior

All providers follow the same contract:
- On success: returns `number[]` of length 1024
- On failure: throws (caller in `LongTermMemory.save()` catches and degrades gracefully)

### Configuration

```env
# Select Ollama for embeddings
EMBEDDING_PROVIDER=ollama

# Optional: override model (default: mxbai-embed-large)
EMBEDDING_MODEL=snowflake-arctic-embed

# Required: Ollama server URL (also used by LLM provider)
OLLAMA_BASE_URL=http://localhost:11434/api
```
