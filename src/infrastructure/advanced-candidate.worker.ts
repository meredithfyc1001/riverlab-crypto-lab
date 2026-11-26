import { evaluateCandidate } from '../core/advanced-research';
import type { AdvancedInput } from '../core/advanced-research';
import type { CandidateJob, CandidateReply } from './advanced-pool';

const scope = globalThis as unknown as {
  onmessage: ((e: MessageEvent<CandidateJob | 'attach-port'>) => void) | null;
  postMessage: (r: CandidateReply) => void;
};
let input: AdvancedInput | undefined;
function evaluate(data: CandidateJob, reply: (result: CandidateReply) => void) {
  try {
    if (data.kind === 'init') {
      input = data.input;
      return;
    }
    if (!input) throw new Error('候选 Worker 缺少研究快照。');
    reply({
      row: evaluateCandidate(input, data.candidate, data.window),
    });
  } catch (e) {
    reply({
      error: e instanceof Error ? e.message : '候选 Worker 失败。',
    });
  }
}

scope.onmessage = ({ data, ports }) => {
  if (data === 'attach-port') {
    const port = ports[0];
    port.onmessage = (event: MessageEvent<CandidateJob>) =>
      evaluate(event.data, (result) => port.postMessage(result));
    port.onmessageerror = () =>
      port.postMessage({
        error: '候选研究输入无法反序列化。',
      } satisfies CandidateReply);
  } else {
    evaluate(data, (result) => scope.postMessage(result));
  }
};
