import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * FR-019 regression test — closes chrisleekr/personal-claw#9.
 *
 * This test is **intentionally static** (source-level grep against
 * `conversations.ts`) because the dynamic route-level test requires mocking
 * the full `services/container` module via `mock.module()`, and Bun's
 * mock.module path resolution has proven unreliable for this particular
 * import chain (the real `services.conversations` continues to be used
 * despite module-level mocks). An end-to-end HTTP test of this route's
 * happy path is covered separately by `apps/api/src/routes/__tests__/conversations.test.ts`.
 *
 * The regression we care about is: **the generate-skill route MUST NOT
 * concatenate untrusted conversation content into an LLM prompt string**.
 * That property is verifiable with a source-level grep, which is the
 * strongest guarantee we can make without end-to-end tests.
 *
 * Behavioral coverage of the detection pipeline running INSIDE the route
 * is provided by:
 *  - `apps/api/src/agent/detection/__tests__/engine.test.ts` — DetectionEngine orchestrator
 *  - `apps/api/src/agent/__tests__/guardrails.test.ts` — GuardrailsEngine delegation + DetectionBlockedError
 *  - `apps/api/src/agent/__tests__/pipeline-detection.test.ts` — pipeline-stage integration (T039)
 *  - `specs/20260409-185147-injection-defense-pipeline/contracts/generate-skill-block.http` — contract document
 */

const ROUTE_SOURCE_PATH = resolve(import.meta.dir, '../conversations.ts');
const routeSrc = readFileSync(ROUTE_SOURCE_PATH, 'utf8');

describe('generate-skill endpoint — FR-019 regression (static)', () => {
  test('route source file exists and is readable', () => {
    expect(routeSrc.length).toBeGreaterThan(0);
  });

  test('NO template literal interpolates userMessages into a generateText prompt', () => {
    // The vulnerable pattern we are guarding against:
    //   prompt: `... ${userMessages} ... ${toolSequenceSummary} ...`
    expect(routeSrc).not.toMatch(/prompt:\s*`[^`]*\$\{userMessages\}/);
    expect(routeSrc).not.toMatch(/prompt:\s*`[^`]*\$\{toolSequenceSummary\}/);
  });

  test('NO `prompt: ` literal followed by a template including user-derived content', () => {
    // Defensive: even if someone renames `userMessages` or `toolSequenceSummary`,
    // any `prompt:` template literal inside `generateText(` is a red flag for
    // this route — the rewrite uses `messages: ModelMessage[]` exclusively.
    const generateTextCalls = routeSrc.match(/generateText\(\{[\s\S]+?\}\)/g) ?? [];
    for (const call of generateTextCalls) {
      // Inside any generateText({...}) block, the prompt field MUST NOT be set.
      // We allow `messages:` but not `prompt:`.
      if (/\bprompt\s*:/.test(call)) {
        throw new Error(
          'generate-skill regression: generateText() call contains a prompt: field. ' +
            'FR-019 requires messages: ModelMessage[] with wrapAsUntrusted() instead.',
        );
      }
    }
    // Assertion: at least one generateText({...}) call was found AND none used `prompt:`.
    expect(generateTextCalls.length).toBeGreaterThanOrEqual(1);
  });

  test('route uses wrapAsUntrusted() to wrap untrusted content for structural separation', () => {
    expect(routeSrc).toContain('wrapAsUntrusted');
  });

  test('route routes untrusted content through detectionEngine.detect() with sourceKind: generate_skill_input', () => {
    expect(routeSrc).toContain('detectionEngine.detect');
    expect(routeSrc).toContain("sourceKind: 'generate_skill_input'");
  });

  test('route returns HTTP 422 with DETECTION_BLOCKED structured body on block (FR-004 response shape)', () => {
    // The detectionBlockBody helper exists in the route and produces the FR-004 shape.
    expect(routeSrc).toContain('DETECTION_BLOCKED');
    expect(routeSrc).toContain('reason_code');
    expect(routeSrc).toContain('reference_id');
    expect(routeSrc).toContain('layers_fired');
    // Look for an explicit 422 status code anywhere in a c.json() call.
    // We don't try to match the full arg list because the first arg can
    // itself contain parentheses (nested function calls).
    expect(routeSrc).toMatch(/,\s*422\)/);
    expect(routeSrc).toContain('c.json(detectionBlockBody');
  });

  test('route does NOT contain any direct string concat of untrusted sections', () => {
    // The old pattern joined userMessages + toolSequenceSummary into a single
    // string via newlines + template literals. The rewrite uses wrapAsUntrusted()
    // which produces a typed ModelMessage. We check that no `${userMessages}`
    // appears in any template literal, period.
    const templateLiterals = routeSrc.match(/`[\s\S]*?`/g) ?? [];
    // Construct the forbidden tokens at runtime so Biome's
    // noTemplateCurlyInString rule doesn't flag the string literals that
    // would otherwise contain "${userMessages}" / "${toolSequenceSummary}".
    // These tokens are exactly the vulnerable interpolation patterns from
    // chrisleekr/personal-claw#9 that we are guarding against.
    const forbiddenUserTokens = '$' + '{' + 'userMessages' + '}';
    const forbiddenToolTokens = '$' + '{' + 'toolSequenceSummary' + '}';
    for (const lit of templateLiterals) {
      if (lit.includes(forbiddenUserTokens) || lit.includes(forbiddenToolTokens)) {
        // One exception: inside the wrapAsUntrusted() call itself, where the
        // untrusted content is labelled with markdown headings. That's fine
        // because wrapAsUntrusted() is specifically designed to wrap it in
        // the <untrusted_content> marker — the template literal there is the
        // DATA payload of a user-role message, not an instruction.
        if (lit.includes('## User requests') || lit.includes('## Tool calls executed')) {
          continue;
        }
        throw new Error(
          `generate-skill regression: template literal contains untrusted interpolation: ${lit.slice(0, 120)}`,
        );
      }
    }
  });

  test('FR-019 regression guard — any future prompt: string re-introduction fails the build', () => {
    // This is the canonical guard. If a developer later re-introduces a
    // `prompt: ` template literal assignment in this file, this test fails
    // immediately and the PR gets rejected.
    const promptFieldCount = (routeSrc.match(/\bprompt\s*:\s*`/g) ?? []).length;
    expect(promptFieldCount).toBe(0);
  });
});
