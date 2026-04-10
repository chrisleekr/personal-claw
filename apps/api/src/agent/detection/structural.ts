import type { ModelMessage } from 'ai';
import type { SourceKind } from './types';

/**
 * FR-002(b) and FR-002a — Structural separation of trusted instructions
 * from untrusted content.
 *
 * The detection pipeline's single strongest guarantee: no untrusted content
 * is ever concatenated into an instruction string sent to an LLM. This module
 * provides two helpers:
 *
 * 1. `wrapAsUntrusted(text, source)` — produces a `ModelMessage` with
 *    `role: 'user'` whose text is explicitly tagged as untrusted via a
 *    human-readable marker the system prompt teaches the model to treat
 *    as data, not instructions.
 *
 * 2. `assertNoConcatenation(messages)` — development-time assertion that
 *    scans an array of `ModelMessage` parts for any instruction-role
 *    content that happens to mention the untrusted marker (a weak signal
 *    that the marker has been stringified into a system prompt). Meant to
 *    catch accidental regressions in call-site wiring; not a runtime
 *    security control.
 *
 * The markers are deliberately unique strings that an attacker cannot
 * easily forge because any attempt to include them in their own input
 * will be escaped by the wrapping step itself.
 */

const UNTRUSTED_OPEN = '<untrusted_content>';
const UNTRUSTED_CLOSE = '</untrusted_content>';
const SOURCE_ATTR_RE = /source="([^"]+)"/;

/**
 * Escapes any existing untrusted_content markers in the input so an attacker
 * cannot break out of the wrapping. The escape uses zero-width joiners to
 * neutralize the marker visually while keeping the content readable.
 */
function escapeMarkers(text: string): string {
  return text
    .split(UNTRUSTED_OPEN)
    .join('<untrusted_content\u200B>')
    .split(UNTRUSTED_CLOSE)
    .join('</untrusted_content\u200B>');
}

/**
 * Wraps a piece of untrusted text in a user-role `ModelMessage` with an
 * explicit source-kind marker. The system prompt teaches the model to
 * treat anything inside `<untrusted_content>` as data, not as instructions.
 *
 * @param text The untrusted text (user message, tool output, memory recall content, etc.)
 * @param source The origin category for this text, used for audit logging
 * @returns A typed `ModelMessage` safe to append to a messages array
 */
export function wrapAsUntrusted(text: string, source: SourceKind): ModelMessage {
  const escaped = escapeMarkers(text);
  return {
    role: 'user',
    content: [
      {
        type: 'text',
        text: `${UNTRUSTED_OPEN}<source="${source}">${escaped}${UNTRUSTED_CLOSE}`,
      },
    ],
  };
}

/**
 * Asserts that no `system`-role message in the given array contains the
 * untrusted-content marker, which would indicate that a caller accidentally
 * stringified an untrusted wrapper into an instruction.
 *
 * Throws a descriptive error if the invariant is violated. This is a
 * correctness guard on call-site wiring, not a defense against attackers.
 *
 * @param messages The full messages array about to be sent to `generateText`
 * @throws If any `system` message contains the untrusted marker
 */
export function assertNoConcatenation(messages: readonly ModelMessage[]): void {
  for (const message of messages) {
    if (message.role !== 'system') continue;
    const content = message.content;
    const text = typeof content === 'string' ? content : serializeParts(content);
    if (text.includes(UNTRUSTED_OPEN) || text.includes(UNTRUSTED_CLOSE)) {
      throw new Error(
        'Structural separation violation: untrusted content marker found inside a system-role message. ' +
          'Untrusted content MUST be placed in a separate user-role message via wrapAsUntrusted().',
      );
    }
  }
}

/**
 * Extracts the source-kind attribute from a previously-wrapped untrusted
 * content marker. Returns `null` if the text does not contain a
 * well-formed wrapper. Exposed for tests and for the audit writer.
 */
export function extractSourceKind(wrappedText: string): string | null {
  const match = wrappedText.match(SOURCE_ATTR_RE);
  return match ? match[1] : null;
}

/**
 * Serializes a `ModelMessage` content array to a flat string for the
 * concatenation-check invariant. Only considers text-type parts; binary
 * parts (images, files) are ignored because they cannot carry the marker.
 */
function serializeParts(content: Extract<ModelMessage['content'], readonly unknown[]>): string {
  let out = '';
  for (const part of content) {
    if (typeof part === 'object' && part !== null && 'type' in part && part.type === 'text') {
      out += (part as { text: string }).text;
    }
  }
  return out;
}
