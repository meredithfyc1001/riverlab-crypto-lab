import {
  evaluateCandidate,
  rankTraining,
  selectTraining,
} from '../core/advanced-research';
import type {
  AdvancedInput,
  AdvancedPlan,
  AdvancedResult,
  Candidate,
  CandidateRow,
  WindowSpec,
} from '../core/advanced-research';

export const MAX_ADVANCED_WORKERS = 4;

/** The original source and one live engine ledger per active evaluation are charged separately. */
export function advancedWorkerCount(
  input: AdvancedInput,
  plan: AdvancedPlan,
  requested: number,
) {
  if (
    !Number.isSafeInteger(requested) ||
    requested < 1 ||
    requested > MAX_ADVANCED_WORKERS
  )
    throw new Error('并发数量必须是 1 至 4 的整数。');
  const longestWindow = Math.max(...plan.windows.map((w) => w.end - w.start));
  return Math.max(
    1,
    Math.min(
      requested,
      plan.candidates.length,
      Math.floor(50_000 / longestWindow),
      Math.floor(100_000 / input.dataset.candles.length),
    ),
  );
}

export interface EvaluationLane {
  evaluate(candidate: Candidate, window: WindowSpec): Promise<CandidateRow>;
  close(): void;
}
export type CandidateJob =
  | { kind: 'init'; input: AdvancedInput }
  | { kind: 'evaluate'; candidate: Candidate; window: WindowSpec };
export type CandidateReply = { row: CandidateRow } | { error: string };

function workerLane(input: AdvancedInput): EvaluationLane {
  const worker = new Worker(
    new URL('./advanced-candidate.worker.ts', import.meta.url),
    { type: 'module' },
  );
  let rejectActive: ((reason: Error) => void) | null = null;
  let failure: Error | null = null;
  function fail() {
    failure = new Error('候选计算 Worker 通信失败，研究未完成。');
    rejectActive?.(failure);
  }
  worker.onerror = fail;
  worker.onmessageerror = fail;
  try {
    worker.postMessage({ kind: 'init', input } satisfies CandidateJob);
  } catch (error) {
    worker.terminate();
    throw error;
  }
  return {
    evaluate(candidate, window) {
      return new Promise((resolve, reject) => {
        if (failure) return reject(failure);
        rejectActive = reject;
        worker.onmessage = ({ data }: MessageEvent<CandidateReply>) => {
          rejectActive = null;
          if (!data || typeof data !== 'object')
            reject(new Error('候选 Worker 响应无效。'));
          else if ('error' in data) reject(new Error(data.error));
          else if (
            data.row?.candidateId !== candidate.id ||
            data.row.window?.role !== window.role ||
            data.row.window.fold !== window.fold ||
            data.row.window.start !== window.start ||
            data.row.window.end !== window.end
          )
            reject(new Error('候选 Worker 返回了其他窗口或候选的结果。'));
          else resolve(data.row);
        };
        worker.postMessage({
          kind: 'evaluate',
          candidate,
          window,
        } satisfies CandidateJob);
      });
    },
    close() {
      worker.terminate();
      rejectActive?.(new Error('高级研究任务已停止。'));
      rejectActive = null;
    },
  };
}

/** Candidate errors are retained as rows by the evaluation engine. A transport error
 * instead aborts the batch because its outcome cannot be reproduced from the input. */
export async function scheduleAdvanced(
  input: AdvancedInput,
  plan: AdvancedPlan,
  requested: number,
  progress: (done: number, total: number) => void,
  createLane = workerLane,
): Promise<AdvancedResult> {
  const count = advancedWorkerCount(input, plan, requested);
  const lanes: EvaluationLane[] = [];
  const result: AdvancedResult = { plan, folds: [] };
  let done = 0;
  try {
    if (count === 1)
      lanes.push({
        evaluate: async (candidate, window) =>
          evaluateCandidate(input, candidate, window),
        close: () => {},
      });
    else for (let i = 0; i < count; i++) lanes.push(createLane(input));
    progress(0, plan.runs);
    for (let i = 0; i < plan.windows.length; i += 2) {
      const training = plan.windows[i],
        testing = plan.windows[i + 1];
      const rows: CandidateRow[] = new Array(plan.candidates.length);
      let next = 0;
      await Promise.all(
        lanes.map(async (lane) => {
          while (next < plan.candidates.length) {
            const index = next++;
            rows[index] = await lane.evaluate(plan.candidates[index], training);
            progress(++done, plan.runs);
          }
        }),
      );
      const train = rankTraining(input, rows);
      const selectedId = selectTraining(train);
      const selected = plan.candidates.find((c) => c.id === selectedId);
      // This is the only test job that can be submitted for the current fold.
      const test = selected ? await lanes[0].evaluate(selected, testing) : null;
      result.folds.push({ train, selectedId, test });
      // A skipped test still consumes its planned progress slot.
      if (plan.candidates.length) progress(++done, plan.runs);
    }
    return result;
  } finally {
    for (const lane of lanes) lane.close();
  }
}
