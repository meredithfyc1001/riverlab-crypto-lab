import { sealExperiment } from '../core/experiments';
import type { Experiment, ExperimentPayload } from '../core/experiments';
import { forEachCanonicalChunk } from '../core/backtests/identity';

/** Same canonical bytes/SHA-256 as contentHash; only the browser Worker adapter
 * uses native digest. It trades one canonical byte buffer for less hashing CPU.
 * The synchronous, streaming pure core and every historical hash stay unchanged.
 */
export async function sealWorkerExperiment(
  payload: ExperimentPayload,
  metadata: Pick<Experiment, 'id' | 'name' | 'createdUtcMs' | 'elapsedMs'>,
): Promise<Experiment> {
  if (!globalThis.crypto?.subtle) return sealExperiment(payload, metadata);
  const chunks: Uint8Array[] = [];
  let size = 0;
  forEachCanonicalChunk(payload, (chunk) => {
    chunks.push(chunk);
    size += chunk.length;
  });
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  chunks.length = 0;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const payloadHash = Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
  return { schemaVersion: 1, ...metadata, payloadHash, payload };
}
