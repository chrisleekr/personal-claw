# Research: Ollama Embedding Provider

**Feature**: 20260406-221125-ollama-embedding-provider
**Date**: 2026-04-06

## R1: Does `ollama-ai-provider-v2` support embeddings?

**Decision**: Yes — the package provides `.embedding()`, `.textEmbeddingModel()` methods that return `EmbeddingModelV3`, fully compatible with Vercel AI SDK's `embed()` function.

**Evidence**: From `ollama-ai-provider-v2@3.3.1` type declarations:

```typescript
embedding(modelId: OllamaEmbeddingModelId, settings?: OllamaEmbeddingSettings): EmbeddingModelV3;
textEmbeddingModel(modelId: OllamaEmbeddingModelId, settings?: OllamaEmbeddingSettings): EmbeddingModelV3;
```

`OllamaEmbeddingSettings` includes `dimensions?: number`, so 1024-dimension output is configurable.

**Alternatives considered**: Using Ollama's raw HTTP API (`/api/embeddings`) directly — rejected because the AI SDK provider already wraps it and maintains consistency with the existing `embed()` pattern.

## R2: Default Ollama embedding model

**Decision**: Use `mxbai-embed-large` as the default Ollama embedding model.

**Rationale**: `mxbai-embed-large` produces 1024-dimension embeddings natively, matching the existing pgvector `vector(1024)` column without requiring dimension truncation or schema migration. This is the safest default for drop-in compatibility.

**Alternatives considered**:
- `nomic-embed-text`: 768-dimension default, requires dimension truncation to 1024 (not supported — truncation only works downward). Incompatible with current schema.
- `nomic-embed-text-v2-moe`: 768-dimension MoE model, multilingual, ~958MB. Same dimension incompatibility. Rejected during clarification.
- `all-minilm`: Only 384 dimensions, too small for 1024 target
- `snowflake-arctic-embed`: Good quality but less Ollama ecosystem adoption

## R3: Dimension compatibility with pgvector (1024)

**Decision**: Request 1024 dimensions via `OllamaEmbeddingSettings.dimensions` parameter, matching the existing `EMBEDDING_DIMENSIONS = 1024` constant.

**Rationale**: The pgvector column is `vector(1024)` with an HNSW index. All embeddings must be exactly 1024 dimensions. The Ollama provider options support `dimensions` — Ollama itself passes this to the model. The default model `mxbai-embed-large` produces 1024 natively, so no truncation is needed. For models that don't support arbitrary dimensions, Ollama returns the model's native dimension, and pgvector will reject mismatched vectors, which triggers the existing graceful degradation path (save without embedding, log warning).

**Risk**: If a user picks an Ollama model that doesn't support 1024 dimensions and doesn't truncate, the embedding insert will fail. This is handled by the existing try/catch in `LongTermMemory.save()` which catches embedding failures gracefully.

## R4: Ollama provider instance reuse

**Decision**: Reuse the same `createOllama()` instance pattern from the existing LLM provider (`apps/api/src/agent/providers/ollama.ts`), but create the embedding instance locally in `embeddings.ts` to avoid coupling embedding code to the LLM provider registry.

**Rationale**: The embedding system is decoupled from the LLM provider system by design. The LLM provider goes through a `ProviderFactory` + registry; embeddings have their own `generateEmbedding()` function. Importing the Ollama provider directly in `embeddings.ts` (same as OpenAI and Bedrock) maintains this separation.

**Alternatives considered**: Importing `ollamaFactory` from providers — rejected because it couples embedding to the LLM provider registry and the factory only exposes `LanguageModel`, not `EmbeddingModel`.

## R5: Configuration approach

**Decision**: Add an optional `OLLAMA_EMBEDDING_MODEL` env var to allow overriding the default embedding model specifically for Ollama, separate from `EMBEDDING_MODEL` (which is the generic override) and `OLLAMA_DEFAULT_MODEL` (which is for LLM).

**Rationale**: The user input specifies "add ollama as additional provider" — this means `EMBEDDING_PROVIDER=ollama` selects Ollama, and `EMBEDDING_MODEL` can override the model (same pattern as OpenAI/Bedrock). An additional `OLLAMA_EMBEDDING_MODEL` env var is unnecessary since `EMBEDDING_MODEL` already serves this purpose. Keep it simple: use the existing `EMBEDDING_MODEL` env var.

**Final decision revised**: Do NOT add `OLLAMA_EMBEDDING_MODEL`. Use the existing `EMBEDDING_MODEL` env var for model override, consistent with how OpenAI and Bedrock work. This is the simplest approach.
