import { z } from 'zod';
import benignJson from './benign.json';
import signaturesJson from './signatures.json';

/**
 * Typed loader for the committed injection corpus files (FR-032).
 *
 * Both `signatures.json` and `benign.json` are version-controlled, parsed at
 * import time via Bun's JSON imports, and validated against the schemas below.
 * Validation happens once at module load — if either file is malformed, an
 * error is thrown that surfaces as a fatal startup failure per research.md
 * R10. There is intentionally no try/catch here: a corrupt corpus must not
 * silently weaken detection.
 *
 * The pipeline reads these typed exports — never the raw JSON — so any future
 * schema evolution is gated by Zod validation.
 */

export const injectionSignatureSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  category: z.string().min(1),
  tags: z.array(z.string()).default([]),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  addedBy: z.string().min(1),
  addedAt: z.string().min(1),
});

export const injectionCorpusSchema = z.object({
  schemaVersion: z.string().min(1),
  description: z.string().optional(),
  signatures: z.array(injectionSignatureSchema).min(1),
});

export const benignSampleSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  category: z.string().min(1),
  tags: z.array(z.string()).default([]),
});

export const benignCorpusSchema = z.object({
  schemaVersion: z.string().min(1),
  description: z.string().optional(),
  samples: z.array(benignSampleSchema).min(1),
});

export type InjectionSignature = z.infer<typeof injectionSignatureSchema>;
export type InjectionCorpus = z.infer<typeof injectionCorpusSchema>;
export type BenignSample = z.infer<typeof benignSampleSchema>;
export type BenignCorpus = z.infer<typeof benignCorpusSchema>;

const parsedSignatures = injectionCorpusSchema.parse(signaturesJson);
const parsedBenign = benignCorpusSchema.parse(benignJson);

/**
 * Returns the validated adversarial corpus parsed at module load time.
 *
 * @returns The full corpus including `schemaVersion` and the array of signatures
 * @throws Never at call time — validation errors are surfaced at import time
 */
export function loadAdversarialCorpus(): InjectionCorpus {
  return parsedSignatures;
}

/**
 * Returns the validated benign corpus parsed at module load time.
 *
 * @returns The full corpus including `schemaVersion` and the array of samples
 * @throws Never at call time — validation errors are surfaced at import time
 */
export function loadBenignCorpus(): BenignCorpus {
  return parsedBenign;
}
