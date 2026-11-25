import { evaluateCandidate } from '../core/advanced-research';
import type { AdvancedInput } from '../core/advanced-research';
import type { CandidateJob, CandidateReply } from './advanced-pool';

const scope = globalThis as unknown as {
  onmessage: ((e: MessageEvent<CandidateJob>) => void) | null;
  postMessage: (r: CandidateReply) => void;
};
let input: AdvancedInput | undefined;
scope.onmessage = ({ data }) => {
  try {
    if (data.kind === 'init') {
      input = data.input;
      return;
    }
    if (!input) throw new Error('候选 Worker 缺少研究快照。');
    scope.postMessage({
      row: evaluateCandidate(input, data.candidate, data.window),
    });
  } catch (e) {
    scope.postMessage({
      error: e instanceof Error ? e.message : '候选 Worker 失败。',
    });
  }
};
