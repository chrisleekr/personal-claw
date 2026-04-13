import { detectionOverrides, eq } from '@personalclaw/db';
import type { InjectionCorpus, InjectionSignature } from '@personalclaw/shared';
import { loadAdversarialCorpus } from '@personalclaw/shared';
import { getDb } from '../../db';

/**
 * FR-032 / FR-033 — Runtime corpus loader combining the committed base
 * corpus with per-channel override entries.
 *
 * Base corpus: `loadAdversarialCorpus()` from `@personalclaw/shared` returns
 * the typed, Zod-validated result of parsing the committed
 * `packages/shared/src/injection-corpus/signatures.json`. That file is
 * immutable at runtime per FR-032.
 *
 * Per-channel overrides: rows in the `detection_overrides` table with
 * `override_kind = 'allowlist_signature'` suppress specific base-corpus
 * signatures for a given channel. Rows with `override_kind = 'block_phrase'`
 * add channel-specific signatures.
 *
 * This module caches nothing — the config cache at
 * `apps/api/src/channels/config-cache.ts` already provides a hot path for
 * channel config, and detection_overrides is read via direct DB queries
 * that benefit from the channel_id index. The merge operation is a simple
 * list filter + concat and costs nothing.
 */

export interface MergedCorpus {
  schemaVersion: string;
  /** Signatures active for the given channel after applying allowlist overrides. */
  signatures: readonly InjectionSignature[];
  /** IDs of base-corpus signatures that were suppressed for this channel. */
  suppressedIds: readonly string[];
}

/**
 * Loads the base corpus and merges per-channel overrides.
 *
 * @param channelId The channel to load overrides for
 * @returns Merged corpus: base signatures minus allowlist suppressions, plus channel-specific block phrases
 */
export async function loadMergedCorpus(channelId: string): Promise<MergedCorpus> {
  const base = loadAdversarialCorpus();

  const overrides = await getDb()
    .select({
      overrideKind: detectionOverrides.overrideKind,
      targetKey: detectionOverrides.targetKey,
    })
    .from(detectionOverrides)
    .where(eq(detectionOverrides.channelId, channelId));

  const suppressedIds: string[] = [];
  const addedSignatures: InjectionSignature[] = [];

  for (const row of overrides) {
    if (row.overrideKind === 'allowlist_signature') {
      suppressedIds.push(row.targetKey);
    } else if (row.overrideKind === 'block_phrase') {
      // Channel-specific block phrases are treated as high-severity
      // signatures scoped to this channel. They are not persisted in the
      // base corpus, so subsequent channels don't see them.
      addedSignatures.push({
        id: `override_${channelId}_${row.targetKey.slice(0, 20)}`,
        text: row.targetKey,
        category: 'channel_block_override',
        tags: ['channel-override'],
        severity: 'high',
        addedBy: 'channel-admin',
        addedAt: 'runtime',
      });
    }
    // trust_mcp_tool overrides are consumed by the approval gateway's
    // tool-output detection path (FR-030), not here.
  }

  const suppressedSet = new Set(suppressedIds);
  const filteredBase = base.signatures.filter((sig) => !suppressedSet.has(sig.id));

  return {
    schemaVersion: base.schemaVersion,
    signatures: [...filteredBase, ...addedSignatures],
    suppressedIds,
  };
}

/**
 * Converts a `MergedCorpus` back into an `InjectionCorpus` shape for passing
 * to layer functions that expect the raw corpus type.
 */
export function asInjectionCorpus(merged: MergedCorpus): InjectionCorpus {
  return {
    schemaVersion: merged.schemaVersion,
    signatures: [...merged.signatures],
  };
}
