// The benchmark build instruments imports in the production Worker only.
import '../../src/infrastructure/backtest.worker';
import type {
  WorkerRequest,
  WorkerResponse,
} from '../../src/infrastructure/backtest-worker';
import { timings } from './timings';

const scope = self as unknown as {
  postMessage: (message: unknown) => void;
  onmessage: (message: MessageEvent<WorkerRequest>) => Promise<void>;
};
const send = scope.postMessage.bind(self);
const run = scope.onmessage;
let receivedAt = 0;
scope.onmessage = (event) => {
  receivedAt = performance.timeOrigin + performance.now();
  return run(event);
};
scope.postMessage = (value) => {
  const response = value as WorkerResponse;
  send({
    response,
    timings,
    receivedAt,
    sentAt: performance.timeOrigin + performance.now(),
  });
};
