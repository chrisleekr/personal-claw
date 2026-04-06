# Feature Specification: Support Embedding Provider for Ollama

**Feature Branch**: `20260406-221125-ollama-embedding-provider`
**Created**: 2026-04-06
**Status**: Draft
**Input**: User description: "Support embedding provider for ollama"

## Clarifications

### Session 2026-04-06

- Q: What should the default Ollama embedding model be? → A: `mxbai-embed-large` — produces 1024-dimension embeddings natively, matching the existing pgvector schema without migration. `nomic-embed-text-v2-moe` was considered but rejected due to 768-dimension output being incompatible with the `vector(1024)` column.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Configure Ollama as Embedding Provider (Priority: P1)

As a self-hosted user running Ollama locally, I want to configure Ollama as my embedding provider so that I can generate embeddings without relying on external cloud services like OpenAI or AWS Bedrock.

**Why this priority**: This is the core capability. Without the ability to select and configure Ollama for embeddings, no other user story is possible. It enables fully local, private, and cost-free embedding generation.

**Independent Test**: Can be fully tested by setting the embedding provider to "ollama", saving a memory, and verifying that an embedding vector is stored in the database.

**Acceptance Scenarios**:

1. **Given** Ollama is running locally with an embedding model available, **When** the user sets the embedding provider to "ollama", **Then** the system uses Ollama to generate embeddings for memory operations.
2. **Given** the embedding provider is set to "ollama", **When** the user does not specify a model, **Then** the system uses a sensible default embedding model.
3. **Given** the embedding provider is set to "ollama", **When** the user specifies a custom Ollama embedding model, **Then** the system uses that model for embedding generation.

---

### User Story 2 - Semantic Memory Search with Ollama Embeddings (Priority: P2)

As a user with Ollama-generated embeddings, I want to perform semantic memory searches so that I can retrieve contextually relevant memories using vector similarity, just as I would with OpenAI or Bedrock embeddings.

**Why this priority**: Embedding generation (P1) is only useful if search works correctly with the resulting vectors. This validates end-to-end functionality.

**Independent Test**: Can be tested by saving several memories with Ollama embeddings, then performing a semantic search query and verifying relevant results are returned ranked by similarity.

**Acceptance Scenarios**:

1. **Given** memories have been saved with Ollama-generated embeddings, **When** a user searches for a related topic, **Then** the system returns semantically similar memories ranked by relevance.
2. **Given** the Ollama embedding model produces vectors of a specific dimension, **When** those vectors are stored, **Then** they are compatible with the existing pgvector search infrastructure.

---

### User Story 3 - Graceful Degradation When Ollama is Unavailable (Priority: P3)

As a user who configured Ollama as the embedding provider, I want the system to handle Ollama being unavailable gracefully so that my memory save operations do not fail catastrophically.

**Why this priority**: Ollama runs locally and may not always be running. The system should degrade gracefully, consistent with existing behavior for other providers.

**Independent Test**: Can be tested by configuring Ollama as the embedding provider, stopping the Ollama service, then saving a memory and verifying it is stored (without embedding) and retrievable via keyword search.

**Acceptance Scenarios**:

1. **Given** the embedding provider is set to "ollama" and Ollama is not running, **When** the system attempts to generate an embedding, **Then** the memory is saved without a vector and a warning is logged.
2. **Given** the embedding provider is set to "ollama" and Ollama is not running, **When** the user searches for memories, **Then** keyword-based search still returns results.

---

### Edge Cases

- What happens when the configured Ollama embedding model produces vectors with a dimension different from the database's expected 1024 dimensions?
- What happens when Ollama is running but the specified embedding model is not downloaded/available?
- What happens when the Ollama base URL is configured but the service is unreachable (network error vs. service down)?
- How does the system behave if a user switches embedding providers mid-use (e.g., from OpenAI to Ollama) when existing memories have embeddings from the previous provider?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST support "ollama" as a valid embedding provider alongside "openai" and "bedrock".
- **FR-002**: System MUST reuse the existing Ollama connection configuration (base URL) already used for LLM inference.
- **FR-003**: System MUST allow users to specify which Ollama model to use for embeddings, independent of the LLM model selection.
- **FR-004**: System MUST use `mxbai-embed-large` as the default embedding model for Ollama when none is explicitly configured. This model produces 1024-dimension embeddings natively.
- **FR-005**: System MUST generate embedding vectors compatible with the existing 1024-dimension pgvector storage and HNSW index.
- **FR-006**: System MUST follow the same graceful degradation pattern as existing providers — log a warning and save without embedding if generation fails.
- **FR-007**: When `EMBEDDING_PROVIDER` is set to "ollama" and the Ollama service is unreachable (including when `OLLAMA_BASE_URL` is unset and the default localhost URL fails), the system MUST degrade gracefully per FR-006. No separate "configured" pre-check is required — the embedding call itself will fail and trigger degradation.

### Key Entities

- **Embedding Provider**: The service responsible for converting text into vector representations. Extended to include "ollama" as a valid option alongside "openai" and "bedrock".
- **Embedding Model**: The specific model within a provider used to generate embeddings. For Ollama, this is user-configurable and defaults to `mxbai-embed-large` (1024 dimensions native).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can save memories with Ollama-generated embeddings and retrieve them via semantic search.
- **SC-002**: Switching to Ollama as the embedding provider requires only configuration changes — no code modifications by the user.
- **SC-003**: Memory operations complete successfully (with graceful degradation) even when the Ollama service is temporarily unavailable.
- **SC-004**: Embedding generation via Ollama completes within acceptable time for local inference (under 5 seconds per embedding for typical memory content).

## Assumptions

- Ollama is already installed and running on the user's machine or accessible network, with at least one embedding-capable model downloaded.
- The default Ollama embedding model (`mxbai-embed-large`) produces 1024-dimension embeddings natively. Users who override with a model producing different dimensions will experience graceful degradation (pgvector rejects mismatched vectors; memory saved without embedding).
- The existing `ollama-ai-provider-v2` package (already used for LLM) supports embedding model operations via the Vercel AI SDK's `embed()` function.
- Users who switch embedding providers understand that existing memories retain their original embeddings and that cross-provider vector similarity may not be meaningful.
- The Ollama base URL configuration already present for LLM use is sufficient for embedding operations (same endpoint serves both).
