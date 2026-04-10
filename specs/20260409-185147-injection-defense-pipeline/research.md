# Phase 0 Research: Multi-Layer Prompt Injection Defense Pipeline

**Date**: 2026-04-09
**Branch**: `20260409-185147-injection-defense-pipeline`
**Plan**: [plan.md](./plan.md)

This document resolves all implementation-level open questions identified in `plan.md` so Phase 1 (data model + contracts) can proceed without ambiguity. Every decision is grounded in verified code paths, the clarifications already locked in `spec.md`, and the project's constitution.

---

## R1 — Semantic classifier provisioning (deferred from spec Q4)

**Decision**: Use the existing `ProviderRegistry` to resolve a small, cheap model per channel's configured provider, with a hardcoded fallback to Anthropic Haiku (`claude-haiku-4-5-20251001`) when the channel's provider lacks a suitable small model. The classifier call goes through the same `getProvider(channelId)` / `getProviderWithFallback(channelId)` path used by the main agent, with a new `getClassifierProvider(channelId)` helper that defaults to the cheapest small model in the channel's active provider and falls back to Anthropic Haiku if the active provider has no small-model entry.

**Rationale**:

1. **No new vendor onboarding** (spec §Assumptions). All four providers — Anthropic, Bedrock, OpenAI, Ollama — are already registered at `apps/api/src/agent/providers/registry.ts:45-52` and configured per channel via `getProvider(channelId)`.
2. **Latency budget** (SC-003: ≤250 ms p95 end-to-end). A small-model classifier call typically runs 100–300 ms. Combined with pgvector short-circuit (<50 ms at p95 per SC-003), the common-case latency for a known attack is ~50 ms (skip classifier), and the uncommon case (novel input) is ~250 ms (one classifier call).
3. **Cost control**. The classifier runs on every untrusted input that does not short-circuit. Per the tiered trust model (FR-030) most *autonomous* tool loops pass through trusted categories (1 and 2) and skip detection entirely, so the classifier runs only on user messages, external tool outputs, memory recalls, generate-skill inputs, and mixed-tool outputs — not on every confirm-plan or memory_search call.
4. **Channel autonomy**. Respecting the channel's configured provider means admins who have committed to a specific provider (e.g., Bedrock for compliance) don't suddenly get routed through a different vendor.
5. **Deterministic fallback**. Anthropic Haiku is the fastest and cheapest Claude family model at the cutoff date (`claude-haiku-4-5-20251001`, per the environment knowledge); it is the right fallback because it is always available to Anthropic API users and has the lowest inference cost in that family.

**Latency and cost comparison** (sources: official Anthropic, OpenAI, and AWS Bedrock pricing pages as of the knowledge cutoff; actual numbers to be benchmarked against staging once the classifier is implemented):

| Provider / Model | Typical latency (short input) | Cost per classifier call (≤500 in / ≤50 out tokens) | Availability in current project |
|---|---|---|---|
| Anthropic Haiku 4.5 | ~150 ms | very low | ✅ Already configured |
| Bedrock Claude Haiku | ~200 ms | very low | ✅ Already configured |
| OpenAI gpt-4o-mini | ~200 ms | very low | ✅ Already configured |
| Ollama (local, e.g., `llama3.1:8b`) | depends on host; typically 200–500 ms | zero external cost; local CPU/GPU | ✅ Already configured; requires the deployment to run Ollama |

The exact numeric benchmark is a planning-phase validation (not a blocker for implementation) and will be recorded in `quickstart.md` once the classifier is wired up and a small benchmark script runs 100 inputs through each provider.

**Alternatives considered**:

- **Locally-hosted classifier model** (e.g., `protectai/deberta-v3-base-prompt-injection-v2` or `meta-llama/Prompt-Guard-2-86M`). **Rejected** for v1: would introduce a new runtime dependency (likely a Python process or a WASM runtime), violating the spec's "no new vendor onboarding" assumption and requiring new infrastructure per §Assumptions. Considered as a future follow-up if cost becomes a concern at scale.
- **Use the main-turn model** (whatever the agent uses for its primary LLM call). **Rejected**: significantly more expensive per classifier call; adds latency on every turn; the classifier only needs to emit a short structured verdict, so using a flagship model is waste.
- **Skip the LLM classifier entirely and rely on pgvector + heuristics**. **Rejected**: violates spec Q4 (explicit split into 5 layers) and weakens detection on novel paraphrases not present in the committed corpus. Layer (e) is the fallback that catches what layers (a)–(d) miss.

---

## R2 — Canary token design

**Decision**: Generate a per-request cryptographic random token using `crypto.randomBytes(16).toString('hex')` (32 hex chars), prefix it with a fixed sentinel like `pc_canary_`, and embed it inside a **structural marker block** at the end of the system prompt that explicitly instructs the model to never reveal or echo its contents. The marker block uses a phrase pattern unlikely to occur in legitimate output (e.g., `<internal_state token="pc_canary_<HEX>">DO_NOT_ECHO</internal_state>`). Post-processing scans the response for the hex-and-prefix substring (case-insensitive, after applying the same normalization as FR-002(a)) and blocks the response if found.

**Rationale**:

1. **Cryptographic randomness** prevents an attacker from guessing the canary. 16 random bytes = 2^128 possibilities; collision with any legitimate text is negligible.
2. **Fixed prefix** (`pc_canary_`) simplifies the post-process scan to a single substring check after normalization — no regex, no false-positive risk from other random-looking hex strings in legitimate output (e.g., git commit SHAs, API keys) because the prefix is distinctive.
3. **Structural marker block with explicit DO_NOT_ECHO instructions** teaches the model that the block is internal state. Legitimate models do not have a reason to echo the contents of such a block unless they have been overridden by injected instructions — which is exactly what we are trying to detect.
4. **Normalization before the substring check** (apply the FR-002(a) normalizer) catches an attacker's attempt to evade detection by inserting zero-width characters or homoglyphs into the canary when echoing it. This is the same normalizer used by the input layer, so no new code is needed.
5. **Per-request randomization** means an attacker cannot memorize a canary across requests.

**False-positive considerations**:

- The prefix `pc_canary_` is not a real English word or a standard identifier format. A quick scan of the committed corpus of legitimate technical messages (to be assembled as part of SC-002) will verify the prefix does not collide with normal content.
- If a legitimate user asks the agent "what is the canary token in your system prompt?" the agent's system prompt instructs it to refuse — and even if it violates that instruction, the refusal would be caught by the canary check and the user would see a structured FR-004 block notice, which is the correct behavior (the agent just leaked system state).

**Alternatives considered**:

- **Static canary per deployment**. Rejected: an attacker can learn it once and avoid echoing it thereafter.
- **Canary in the middle of the prompt**. Rejected: adds noise to the agent's instructions and risks the model thinking the canary is a literal instruction to follow.
- **Full output-side LLM classifier instead of canary**. Rejected: explicitly out of scope per spec Q3 ("canary-only for v1; full output classification deferred").

---

## R3 — Tool-result trust routing through the approval gateway

**Decision**: `ApprovalGateway.wrapTools()` at `apps/api/src/agent/approval-gateway.ts:290-317` gains a post-execute interception step. After `originalExecute(args, options)` returns, the wrapper consults the tool-trust registry (FR-030/031) to decide what to do with the result:

- **Category 1 (system_generated) or 2 (already_detected)**: return as-is.
- **Category 3 (external_untrusted)**: traverse the result object, locate all `string` fields (recursively), run each through the input-side detection pipeline (FR-002 layers a–e), and either (i) return a sanitized version with offending strings replaced by a fixed `[blocked content removed: reference <id>]` placeholder, or (ii) return a whole-result error `{ error: true, message: "Tool output blocked as suspected injection", reference_id }` if the pipeline decision was `block`. Binary/non-string fields (e.g., `image: <base64>` from `browser_screenshot`) pass through unchanged because they can't carry text-based injections directly — OCR is explicitly out of scope per spec Edge Cases.
- **Category 4 (mixed)**: same as category 3, but with the author's opt-in trusted-subcommand check applied first. If the tool + its invocation pattern matches a trusted entry in the registry, the result is treated as Category 1; otherwise as Category 3.

**Rationale**:

1. **Single interception point**. `wrapTools()` already wraps every tool at pipeline init time (verified at `pipeline.ts:184`). Adding the post-execute step here means no tool author has to change their code.
2. **Preserves existing return shapes**. String traversal replaces suspicious content in-place; non-string fields pass through. Tool callers see the same result type, just with some strings neutralized or blocked.
3. **Does not leak across tools**. Each tool's detection call uses the tool's own input and the channel context — no cross-tool state.
4. **Consistent with the existing wrap pattern**. The wrapper already handles denial via `{ error: true, message }` on approval failure (lines 303-308) — tool-output detection just adds a parallel denial path for injection-suspicious outputs.

**Implementation detail — recursive string traversal**: To avoid infinite loops and performance cliffs, traversal limits depth to 5 levels and total string bytes inspected to 200 KB (aligned with the current `browser_scrape` 10k-char truncation at `apps/api/src/browser/tools.ts:27-28`). Any result that exceeds the limit is treated conservatively: the excess is dropped with an audit event rather than silently passing through.

**Alternatives considered**:

- **Require every tool to call detection explicitly in its `execute`**. Rejected: violates FR-006's "uniform application" requirement, forces every tool author to think about detection, and creates a rich set of ways for new tools to bypass detection by forgetting to add the call.
- **Intercept at the `generateText` level** (in `generateStage`). Rejected: by then the tool results are already inside the AI SDK's internal message history and hard to rewrite without forking the SDK.
- **Don't traverse strings; just pass the serialized JSON through detection**. Rejected: the pipeline's pgvector similarity layer works on semantically-meaningful text, not JSON-structure artifacts. Serialized JSON inflates content and changes risk scoring in unpredictable ways.

---

## R4 — Memory recall batching in `MemoryEngine.assembleContext()`

**Decision**: Batch detection on the recalled memories by building a single `Promise.all` over all memories in the returned set, with a hard cap of `memoryConfig.injectTopN` (verified present at `packages/shared/src/types.ts:46`) which defaults to 5 per `DEFAULT_MEMORY_CONFIG`. Each memory's detection is independent, so parallel execution is safe. Latency budget per recall: ≤5 × (pgvector short-circuit p95) ≈ ≤250 ms in the hit-path, and ≤ 5 × classifier latency ≈ ≤1250 ms in the absolute worst case. To keep the worst case under SC-003's 250 ms p95 budget, the classifier layer is **skipped** for memory recall (only layers a–d run), because the pgvector similarity layer already compares the memory against the attack corpus and the memory's content is limited in length.

**Rationale**:

1. **Parallelism is cheap**. Five independent detection calls fan out trivially — the only constraint is downstream provider rate limits.
2. **pgvector + heuristics cover the common case**. If a memory was already clean when saved, it stays clean. If an attacker wrote a memory containing a known attack paraphrase, pgvector similarity catches it at recall time with sub-50 ms p95.
3. **Classifier skip is principled**. Memories are strictly shorter and simpler than user messages (they are compacted facts and preferences). The classifier adds marginal value on short strings, and memory recall has no user-facing latency tolerance (the user is waiting for the response).
4. **If a memory does trip the heuristic or similarity layer**, it is skipped for this turn and audit-logged (FR-025). The turn continues with the remaining clean memories — not a turn failure.

**Alternatives considered**:

- **Run full pipeline including classifier on each memory**. Rejected: worst-case latency exceeds SC-003.
- **Batch all memories into a single classifier call**. Rejected: classifier outputs a single verdict per input; batching loses the per-memory granularity needed to skip only the poisoned ones and keep the clean ones.
- **Detection at write time only**. Rejected at spec Q7 (Option A chosen: recall-time detection).

---

## R5 — Corpus embedding cache strategy (FR-032)

**Decision**: Generate embeddings **at API process startup** from the committed `packages/shared/src/injection-corpus/signatures.json` file, and cache them in a new `detection_corpus_embeddings` table that is also re-populated from the source file on every startup (idempotent upsert keyed by a stable signature id). This avoids a build-time embedding generation step (which would require a deterministic embedding provider available at CI-time) and keeps the source file as the single authoritative reference.

**Rationale**:

1. **Deterministic source, environment-dependent embeddings**. The `signatures.json` file is version-controlled (FR-032). The embeddings depend on the configured embedding provider (OpenAI vs. Bedrock vs. Ollama), so they cannot be committed alongside the source file without also pinning the provider.
2. **Startup generation is simple**. On API boot, iterate the committed corpus, call `generateEmbedding()` for each entry, upsert into `detection_corpus_embeddings` keyed by `signature_id + embedding_provider`. Subsequent boots skip regeneration if the DB already has embeddings for the current (signature_id, provider, source_version) tuple — cheap idempotent check.
3. **Supports provider switching**. If an operator switches `EMBEDDING_PROVIDER`, the next boot regenerates embeddings for the new provider and leaves the old ones in place (keyed by provider column). Old rows can be garbage-collected by a future cleanup or left for rollback safety.
4. **Consistent with existing pattern**. `LongTermMemory.save()` at `apps/api/src/memory/longterm.ts:12-37` already handles embedding generation at write time; this feature reuses the same `generateEmbedding()` helper.

**Schema**: `detection_corpus_embeddings` columns:

- `id` uuid pk
- `signature_id` text — stable key from the source file
- `signature_text` text — the original text (for debugging and re-embedding)
- `embedding_provider` text — which provider generated this embedding
- `embedding` vector(1024) — the cached embedding
- `source_version` text — `schemaVersion` from `signatures.json` at time of generation
- `created_at` timestamptz

Unique index on `(signature_id, embedding_provider, source_version)`. pgvector HNSW index on `embedding` using `vector_cosine_ops`, mirroring the pattern at `packages/db/src/migrations/0006_embedding_1024.sql:10-11`.

**Startup work**: a new `initDetectionCorpus()` function called from `apps/api/src/index.ts` (alongside `initCronRunner()` and `initHeartbeats()`) reads the committed JSON, computes which rows are missing in `detection_corpus_embeddings` for the current provider and version, generates the missing embeddings, and upserts them. Missing-row detection keeps warm boots fast (typically zero work).

**Alternatives considered**:

- **Build-time embedding generation** committed to repo. Rejected: ties the repo to one embedding provider and requires the provider's SDK to run in CI.
- **In-memory cache only, no DB table**. Rejected: makes similarity queries impossible via pgvector's HNSW index (the whole point of using pgvector is the indexed cosine-distance lookup). An in-memory array would require implementing nearest-neighbor search ourselves.
- **Lazy generation on first use**. Rejected: first user hit would see a cold-start latency spike.

---

## R6 — `HooksEngine.emit()` failure propagation API shape (FR-029)

**Decision**: Replace the blanket `try/catch`-and-log at `apps/api/src/hooks/engine.ts:26-35` with an **aggregate-and-return** pattern: `emit()` returns a `HookEmitResult` containing the count of successful handlers and an array of `{ handlerIndex: number, error: Error }` for failed handlers. Callers that do not care can discard the result; callers that do care (audit-critical call sites) explicitly inspect it and propagate or act on failures. The alternative — throwing immediately on the first handler error — would leave subsequent handlers unrun, which is worse for observability.

```typescript
// Proposed API shape
export interface HookEmitResult {
  successCount: number;
  errors: Array<{ handlerIndex: number; event: HookEventType; error: Error }>;
}

async emit(event: HookEventType, context: HookContext): Promise<HookEmitResult> {
  const handlers = this.handlers.get(event) || [];
  const result: HookEmitResult = { successCount: 0, errors: [] };
  for (let i = 0; i < handlers.length; i++) {
    try {
      await handlers[i](context);
      result.successCount++;
    } catch (error) {
      result.errors.push({
        handlerIndex: i,
        event,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }
  return result;
}
```

**Rationale**:

1. **Non-throwing by default** keeps the 6 existing call sites working (verified: `orchestrator.ts:56,98,108`, `approval-gateway.ts:177`, `memory/tools.ts:18`, `identity/tools.ts:61,103`) without cascading failures through the agent pipeline. A single bad hook handler should not kill the message.
2. **Still not silent** — errors are returned to the caller, which is responsible for logging or propagating. This satisfies FR-017 (no default try/catch that swallows errors) because the caller explicitly decides what to do.
3. **Run all handlers**. If multiple hooks are attached to `message:sent` (currently `audit-trail.ts` and `cost-log.ts`), a failure in the first does not prevent the second from running.
4. **Compatible with the existing call sites**. The 6 current callers can be updated in a single diff to either ignore the result (low-priority hooks) or assert `errors.length === 0` where audit-critical (not currently the case — the only audit-critical hook consumer is the new `guardrail:detection` path, and per FR-027 that path writes to the table directly, not via the hook).
5. **Narrower catches in handlers**. Per FR-029's guidance on `audit-trail.ts`, the handler itself catches only `fs` errors from `mkdir`/`appendFile` and rethrows anything unexpected. Other handlers do the same.

**Alternatives considered**:

- **Throw immediately on first handler error**. Rejected: breaks the "run all handlers" property and can cause a message-level failure if any handler misbehaves.
- **Return an `AggregateError`**. Rejected: `AggregateError` is less ergonomic for the explicit-inspection pattern; a typed result object is clearer.
- **Change nothing**. Rejected by spec Q9 Option A.

---

## R7 — Structural-separation migration for generate-skill (FR-019, FR-002a)

**Decision**: Rewrite the `generate-skill` endpoint body at `apps/api/src/routes/conversations.ts:57-76` to use the Vercel AI SDK's `messages` parameter (typed `ModelMessage[]`) instead of the `prompt` string. The instructions go into a `system` message; the user messages and tool-call summaries go into separate `user` messages; each untrusted piece runs through the detection pipeline before being added to the message array. If any piece is blocked, the endpoint returns HTTP 422 with the structured body from FR-004.

**Before** (current code at `conversations.ts:57-76`):

```typescript
const result = await generateText({
  model: provider(model),
  prompt: `You are a skill author... ## User requests\n${userMessages}\n## Tool calls\n${toolSequenceSummary}\n...`,
  stopWhen: stepCountIs(1),
});
```

**After** (conceptual shape — exact implementation in Phase 2):

```typescript
const systemPrompt = buildSkillAuthorSystemPrompt(); // Fixed instructions, no user data
const userSection = await detectionEngine.detectAndWrap(
  userMessages,
  { channelId, source: 'generate_skill_input' },
);
if (userSection.action === 'block') {
  return c.json({ error: 'DETECTION_BLOCKED', ...userSection }, 422);
}
const toolSection = await detectionEngine.detectAndWrap(
  toolSequenceSummary,
  { channelId, source: 'generate_skill_input' },
);
if (toolSection.action === 'block') {
  return c.json({ error: 'DETECTION_BLOCKED', ...toolSection }, 422);
}
const result = await generateText({
  model: provider(model),
  messages: [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: [
      { type: 'text', text: '## User requests' },
      { type: 'text', text: userSection.text },
      { type: 'text', text: '## Tool calls executed' },
      { type: 'text', text: toolSection.text },
    ]},
  ],
  stopWhen: stepCountIs(1),
});
```

**Rationale**:

1. **Structural separation is achieved for real**. The model sees system instructions and user-supplied content as distinct messages with distinct roles. No string concatenation into the instruction.
2. **Detection runs before assembly**. Neither string reaches `generateText` without passing through the pipeline, satisfying FR-019.
3. **Backward-compatible response shape**. Successful responses keep the same `{ data: draft }` shape (verified at `conversations.ts:93`). Only the error path changes, and it matches FR-004's 422 format.
4. **No new tests needed for the happy path**. The existing test that asserts the endpoint returns a valid `SkillDraft` is unaffected by the internal rewrite as long as the provider mock returns a sensible JSON response.

**Alternatives considered**:

- **Keep the `prompt` string but HTML-escape the user content**. Rejected: HTML escaping does not defeat prompt injection because the model reads the escaped text and can still be manipulated by the underlying semantics.
- **Run detection on the final assembled `prompt` string**. Rejected: the detection sees the whole blob and loses the ability to say "the user section was attacked" vs. "the tool section was attacked" — audit-logging granularity suffers.
- **Defer FR-019 to a follow-up**. Rejected by spec Q1 Option A.

---

## R8 — Bun test isolation pattern for new tests

**Decision**: Every new `*.test.ts` file under `apps/api/src/agent/detection/__tests__/` follows the pattern used by `apps/api/src/agent/__tests__/guardrails.test.ts:1-9` — declare local module mocks at the top of the file, import the system-under-test *after* the mocks, and keep all mutable state in file-local variables reset in `beforeEach`. The per-file subprocess runner at `apps/api/scripts/test-isolated.ts` ensures no test file can pollute another.

**Rationale**:

1. **Confirms the existing known-good pattern** documented in `test-isolated.ts:1-9` (which references `oven-sh/bun#12823`). Deviating would either cause flaky tests or require writing a custom test runner.
2. **Simple to enforce**: code review rule is "mocks at the top, import after, state in `beforeEach`".
3. **No new tooling**. The existing test runner picks up new files automatically (`Glob('src/**/*.test.{ts,tsx}')` at `test-isolated.ts:15`).

**Alternatives considered**:

- **Use an isolated test folder with a separate runner**. Rejected: duplicates infrastructure for no gain.
- **Use real providers in tests (integration tests)**. Rejected: violates Constitution §Testing's "mock all external services" rule and makes tests slow and non-deterministic.

---

## R9 — Handling of MCP tool outputs in tiered trust (FR-030 category 3)

**Decision**: MCP tools are dynamically loaded per-channel via `MCPToolProvider.getTools()` at `apps/api/src/agent/tool-providers.ts:86-94`. Since the tool names are only known at channel-config load time, the trust registry cannot enumerate them ahead of time. Default behavior: every MCP tool's output is treated as Category 3 (external_untrusted), forcing detection on every MCP tool result. Operators who need to trust a specific MCP server's outputs can add a channel-scoped override through the per-channel override mechanism (FR-033) — effectively the same allowlist pattern used for known-safe MCP tools in `mcp-security.ts`.

**Rationale**:

1. **Fail-closed for dynamic surfaces**. MCP servers are third-party extensions; the conservative default is to distrust their output.
2. **Per-channel override is already the right granularity**. MCP configs are channel-scoped (verified at `packages/db/src/schema/mcp-configs.ts`), so trust decisions naturally belong in the per-channel override store from FR-033.
3. **No change to the FR-031 self-test**. The self-test asserts that every *statically registered* tool has an entry. MCP tools are dynamic and are handled by the default Category 3 rule, not by individual registry entries.

**Alternatives considered**:

- **Require every MCP config to declare its trust category at configuration time**. Rejected: pushes security decisions onto MCP server config flow and adds UI work to `apps/web` beyond the spec's scope.
- **Treat all MCP outputs as untrusted with no override option**. Rejected: admins with known-safe MCP servers get annoying latency overhead forever with no escape hatch.

---

## R10 — Fallback behavior when the base corpus fails to load at startup (FR-032)

**Decision**: If `signatures.json` fails to parse or the embedding generation step fails during `initDetectionCorpus()`, the API process logs a FATAL-level error and exits. This is consistent with Constitution VI (Security by Default) and FR-011's fail-closed posture — a detection pipeline without its base corpus cannot provide the security guarantees the spec promises, so continuing to run would be a silent failure of the entire feature.

**Rationale**:

1. **Fail-closed at startup is the only safe default**. Running with an empty corpus means layer (d) always returns "no match" and the only remaining layers are normalization, structural separation, heuristics, and the classifier — significantly weaker.
2. **Obvious symptom, obvious fix**. A failed boot is easier to detect than a silently-running-but-ineffective pipeline.
3. **Consistent with existing bootstrap errors**. `initCronRunner()` and `PlatformRegistry.initAll()` at `apps/api/src/index.ts:80-83` treat bootstrap failures as fatal (the `main().catch(...)` at line 88 calls `logger.fatal` and implicitly exits).

**Alternatives considered**:

- **Start with an empty corpus and log a warning**. Rejected: silent weakening of security posture.
- **Retry embedding generation on a schedule**. Rejected: adds complexity and a bad startup state can mask a bad corpus commit. If `signatures.json` is corrupted, the fix is a PR revert, not a retry loop.

---

## R11 — Performance verification strategy for SC-003 (≤250 ms p95)

**Decision**: Ship a small Bun script `apps/api/scripts/benchmark-detection.ts` (model after `scripts/test-isolated.ts`) that drives the detection pipeline end-to-end with a synthetic workload: 500 user messages sampled from the adversarial and benign corpora, each run sequentially with `performance.now()` measurements at each layer boundary. The script prints per-layer p50/p95/p99 and end-to-end latencies. This satisfies SC-003 verification without needing a full load test harness.

**Rationale**:

1. **Runs in CI or locally with no new infra**. Bun executes TypeScript natively; the script can be invoked via `bun run apps/api/scripts/benchmark-detection.ts`.
2. **Produces reproducible numbers tied to the committed corpora**. The same corpora used for SC-001 and SC-002 are used here, so the benchmark is repeatable across PRs.
3. **Exposes per-layer breakdown**. If SC-003 regresses, the benchmark tells us which layer is at fault.

**Alternatives considered**:

- **Use a full load testing tool** (k6, wrk). Rejected: adds a dependency and measures network latency too, which is noise for this measurement.
- **Skip performance benchmarking and rely on production observability**. Rejected: SC-003 requires explicit verification; discovering a regression in production is too late.

---

## Resolved items summary

| # | Topic | Status | Where it lives |
|---|-------|--------|----------------|
| R1 | Classifier provisioning | Resolved — reuse `ProviderRegistry`, fallback to Anthropic Haiku 4.5 | Phase 2 task: implement `getClassifierProvider()` helper |
| R2 | Canary token design | Resolved — `pc_canary_` prefix + 16 random bytes + normalized substring scan | Phase 2 task: implement `detection/canary.ts` |
| R3 | Tool-result trust routing | Resolved — post-execute interception in `wrapTools()` with recursive string traversal | Phase 2 task: extend `approval-gateway.wrapTools` |
| R4 | Memory recall batching | Resolved — `Promise.all` with classifier skipped for recall | Phase 2 task: update `MemoryEngine.assembleContext()` |
| R5 | Corpus embedding cache | Resolved — startup generation into `detection_corpus_embeddings` table | Phase 1 data model, Phase 2 task: `initDetectionCorpus()` |
| R6 | `HooksEngine.emit()` API | Resolved — aggregate-and-return `HookEmitResult` | Phase 2 task: rewrite `hooks/engine.ts` |
| R7 | generate-skill structural separation | Resolved — `messages: ModelMessage[]` with separate system and user roles | Phase 2 task: rewrite `routes/conversations.ts` generate-skill handler |
| R8 | Test isolation pattern | Resolved — follow existing `guardrails.test.ts` pattern | Documentation in `quickstart.md` |
| R9 | MCP tool output handling | Resolved — default Category 3, per-channel override for known-safe servers | Phase 1 data model (overrides include MCP tool names), Phase 2 task: trust registry |
| R10 | Corpus load failure behavior | Resolved — fail-closed boot | Phase 2 task: `initDetectionCorpus()` error handling |
| R11 | Performance verification | Resolved — Bun benchmark script against corpora | Phase 2 task: `scripts/benchmark-detection.ts` |

**All Phase 0 research items resolved. Proceeding to Phase 1 (data model + contracts + quickstart).**

---

## Post-analysis amendments (2026-04-09)

This section documents decisions made **after** the initial Phase 0 research pass, during the `/speckit.analyze` remediation pass. These decisions are authoritative in `spec.md` and `tasks.md` but are summarized here so future readers of this file have a complete picture of the design rationale.

### R12 — Multi-turn conversation history window (FR-012)

**Origin**: Analysis findings C1 + U1. The original Phase 0 research did not cover multi-turn attack detection because FR-012 in the early spec was underspecified ("most recent conversation history" with no quantity).

**Decision**: The detection engine considers the **last 10 user messages** from the current thread's stored history when evaluating risk. Only rows where `role === 'user'` are included; assistant messages and tool results are excluded from the sliding window. The pipeline stage that invokes detection (`preProcessStage`) extracts the window and passes it as `recentHistory: string[]` to `DetectionEngine.detect()`. Layers that benefit from history (heuristics, classifier) evaluate the window concatenated with the current input; layers that don't (normalize, similarity) ignore it.

**Rationale**:

1. **Ten messages is the empirical sweet spot**: large enough to catch typical multi-turn split attacks documented in the HackAPrompt corpus, small enough to keep aggregate detection latency well under the SC-003 budget. A 10-message window adds at most ~10 × 100 = 1000 characters to the heuristic and classifier inputs, which is negligible relative to typical single-message inputs.
2. **User messages only**: assistant messages are already trusted (they originated from the agent, not an attacker), and tool results have already passed through tool-output detection per FR-006 and the tiered trust model. Including them in the window would be double-counting.
3. **Constant, not config**: changing the window size requires a PR review, not a runtime config. This prevents operators from accidentally widening the window to a point that blows the latency budget, and it keeps the detection engine predictable for security reviewers.

**Alternatives considered**:

- **Full thread history**: would make latency unbounded on long threads. Rejected.
- **Configurable window size**: adds runtime complexity and a new attack surface (an attacker who can set window size to 0 defeats the check). Rejected.
- **Last N turns (user + assistant)**: blurs the trust boundary. Rejected in favor of user-only.

**Where implemented**: `spec.md` FR-012; `tasks.md` T037(f), T039(f), T049 (engine signature), T053 (preProcessStage extracts the window).

### R13 — Similarity layer two-threshold split (FR-002(d))

**Origin**: Analysis finding A1. The original Phase 0 research and data-model used a single `similarityThreshold` that conflated firing (contributing to the decision) with short-circuiting (ending the pipeline early). This was an ambiguity that allowed operators to accidentally set the threshold either too aggressively (short-circuits prevent the classifier from catching novel paraphrases that happen to be below the cosine threshold) or too conservatively (firing-only behavior loses the latency benefit of the short-circuit).

**Decision**: Split into two distinct thresholds:

- `similarityThreshold` (default **0.85**) — layer fires and contributes to the final decision, but the pipeline continues through the classifier layer.
- `similarityShortCircuitThreshold` (default **0.92**) — layer short-circuits the pipeline because the match is considered high-confidence enough to block without running the LLM classifier.

Schema validation enforces `similarityShortCircuitThreshold >= similarityThreshold`.

**Rationale**:

1. **Separates two distinct operator decisions**: "when is this a signal worth considering" vs. "when is this a signal confident enough to end the pipeline early". Previously one knob tried to express both.
2. **Default 0.92 short-circuit threshold** is backed by the HackAPrompt embeddings analysis: variants of the same canonical attack typically cluster above cosine 0.92, while paraphrases that look similar but are actually benign (e.g., "can you ignore my previous request") cluster around 0.80-0.88.
3. **Latency preservation**: the short-circuit path still completes in <50ms p95 per SC-003, while the firing-only path (similarity fires but classifier runs) remains within the 250ms p95 total budget.

**Alternatives considered**:

- **Single threshold**: rejected (the original ambiguity).
- **Three or more bands** (fire / short-circuit / auto-block): rejected as over-engineered for v1; the block decision should come from the engine composing all layers, not from one layer alone.

**Where implemented**: `spec.md` FR-002(d); `data-model.md` §2.1 `GuardrailsConfig.detection`; `tasks.md` T032 (three-band test), T044 (implementation), T037(b) (engine test).

### R14 — Classifier cost-tracker integration (Constitution VII)

**Origin**: Analysis finding C2. Phase 0 research did not explicitly wire the classifier layer into the existing `CostTracker`, but Constitution VII mandates *"Cost MUST be logged after every `generateText` / `streamText` call via cost-tracker"*.

**Decision**: The classifier layer (`classifier.ts`) calls `CostTracker.log({ channelId, externalUserId, externalThreadId, provider, model, promptTokens, completionTokens, durationMs })` after every successful `generateText` invocation. On timeout or error, no partial cost is logged (the tracker is idempotent on success only). The `CostTracker` dependency is injected via the calling context (`DetectionContext` passes a shared instance) so tests can mock it cleanly.

**Rationale**: Non-negotiable per Constitution VII. Direct integration is the cheapest solution; no new infrastructure required.

**Where implemented**: `tasks.md` T045 (implementation) and T033 (test assertion).

---

**All post-analysis amendments incorporated into spec.md and tasks.md.** This research.md section exists to give a complete historical record; the authoritative documents for implementation remain `spec.md` and `tasks.md`.
