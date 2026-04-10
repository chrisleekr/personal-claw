/**
 * FR-002(a) — Input normalization and canonicalization.
 *
 * Applies a deterministic, idempotent sequence of transforms so that later
 * layers (heuristics, similarity, classifier) see canonical text regardless
 * of how an attacker tried to disguise it.
 *
 * Transforms (in order):
 * 1. Unicode NFC canonicalization — combines decomposed characters
 * 2. Zero-width / invisible character removal — U+200B, U+200C, U+200D,
 *    U+200E, U+200F, U+FEFF, U+2060, U+180E
 * 3. Homoglyph folding — maps common Cyrillic/Greek/mathematical lookalikes
 *    to their Latin equivalents. Not exhaustive; covers the highest-frequency
 *    attack patterns documented in the HackAPrompt corpus.
 * 4. Whitespace collapse — multiple spaces/tabs/newlines to a single space,
 *    trim leading/trailing whitespace.
 * 5. Case lowering — everything lowered for downstream case-insensitive matching.
 * 6. Base64 detection — if the text is entirely a base64-looking payload of
 *    non-trivial length, also return the decoded candidate for inspection.
 *    (The original remains the primary output; the decoded form is a side
 *    channel that later layers can optionally inspect.)
 *
 * The function is idempotent: `normalize(normalize(x).normalized).normalized`
 * equals `normalize(x).normalized`.
 */

// Explicit alternation (not a character class) because U+200D is the
// zero-width joiner which would otherwise flag Biome's
// noMisleadingCharacterClass rule (it composes emoji sequences).
const ZERO_WIDTH_PATTERN = /\u200B|\u200C|\u200D|\u200E|\u200F|\u2060|\uFEFF|\u180E/g;

/**
 * Homoglyph map. Keys are non-Latin characters; values are their Latin
 * equivalents. Extended gradually as new attack variants appear in the
 * committed corpus.
 *
 * Coverage (representative — not exhaustive):
 * - Cyrillic: а, е, о, р, с, у, х, і, ј (common look-alikes)
 * - Greek: α, ε, ο, ρ, ν, μ
 * - Mathematical alphanumerics: 𝐚 𝐛 𝐜 ... (bold) map to their lowercase forms
 */
const HOMOGLYPH_MAP: Record<string, string> = {
  // Cyrillic lowercase
  а: 'a',
  е: 'e',
  о: 'o',
  р: 'p',
  с: 'c',
  у: 'y',
  х: 'x',
  і: 'i',
  ј: 'j',
  // Cyrillic uppercase
  А: 'A',
  Е: 'E',
  О: 'O',
  Р: 'P',
  С: 'C',
  У: 'Y',
  Х: 'X',
  І: 'I',
  // Greek lowercase
  α: 'a',
  ε: 'e',
  ο: 'o',
  ρ: 'p',
  ν: 'v',
  // Mathematical bold lowercase — small sample covering vowels + common consonants
  𝐚: 'a',
  𝐞: 'e',
  𝐢: 'i',
  𝐨: 'o',
  𝐮: 'u',
  𝐠: 'g',
  𝐧: 'n',
  𝐫: 'r',
};

function foldHomoglyphs(text: string): string {
  let out = '';
  for (const ch of text) {
    out += HOMOGLYPH_MAP[ch] ?? ch;
  }
  return out;
}

/**
 * Attempts to decode a string that looks like an entire base64 payload.
 * Returns `null` if the candidate is too short, contains invalid
 * characters, or decodes to binary (non-UTF-8) content.
 */
function tryDecodeBase64(text: string): string | null {
  const trimmed = text.trim();
  // Ignore short strings; base64 of a meaningful phrase is at least a few chars.
  if (trimmed.length < 16) return null;
  // Strict base64 alphabet only (ignore surrounding whitespace after trim).
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) return null;
  // Length must be a multiple of 4.
  if (trimmed.length % 4 !== 0) return null;
  try {
    const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
    // Reject if the decoded string has non-printable bytes (likely binary).
    // Allow tab, newline, CR, and all printable ASCII + extended UTF-8.
    // biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally rejecting control chars
    const looksLikeText = !/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(decoded);
    return looksLikeText && decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
}

export interface NormalizeResult {
  /** The canonicalized text the rest of the pipeline consumes. */
  normalized: string;
  /** True when any transform modified the input (normalized !== input). */
  changed: boolean;
  /** If the input looked like a complete base64 payload, the decoded form (for secondary inspection by other layers). */
  decodedBase64: string | null;
}

/**
 * Normalizes a piece of input text according to the FR-002(a) rules above.
 *
 * @param input Raw text from an untrusted source
 * @returns Normalization result including the canonical form, a `changed` flag,
 *   and an optional decoded base64 payload for secondary inspection
 */
export function normalize(input: string): NormalizeResult {
  // Unicode NFC
  let text = input.normalize('NFC');
  // Zero-width strip
  text = text.replace(ZERO_WIDTH_PATTERN, '');
  // Homoglyph fold
  text = foldHomoglyphs(text);
  // Whitespace collapse and trim
  text = text.replace(/\s+/g, ' ').trim();
  // Case lower
  text = text.toLowerCase();

  const decodedBase64 = tryDecodeBase64(input);

  return {
    normalized: text,
    changed: text !== input,
    decodedBase64,
  };
}
