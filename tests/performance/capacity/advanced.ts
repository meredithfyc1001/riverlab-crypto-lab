import { responsiveness } from '../responsiveness';
import { advancedCapacityInput } from './advanced-input';
import { advancedTask } from '../../../src/infrastructure/advanced-worker';
import { prepareBacktest } from '../backtest-input';

async function run() {
  const baseline = await prepareBacktest();
  const stop = responsiveness();
  try {
    return { ...(await sample(baseline)), ...stop() };
  } finally {
    stop();
  }
}

async function sample(baseline: Awaited<ReturnType<typeof prepareBacktest>>) {
  const input = advancedCapacityInput(baseline);
  const request = {
    kind: 'run',
    input,
    name: '5E 容量测量',
    concurrency: 4,
  } as const;
  const { workers, plan } = await advancedTask({
    kind: 'preview',
    input,
    concurrency: 4,
  }).promise;
  let requestedAt: number | null = null;
  const partial = advancedTask(request, (done) => {
    if (done > 0 && requestedAt === null) {
      requestedAt = performance.now();
      partial.cancel();
    }
  });
  let cancelled = false;
  try {
    await partial.promise;
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('已取消'))
      throw error;
    cancelled = true;
  }
  if (!cancelled || requestedAt === null) throw new Error('未按进度取消');
  const cancelMs = performance.now() - requestedAt;
  const begin = performance.now();
  const serial = await advancedTask({ ...request, concurrency: 1 }).promise;
  const joined = performance.now();
  const { record } = await advancedTask(request).promise;
  const ran = performance.now();
  if (
    JSON.stringify(serial.record.result) !== JSON.stringify(record.result) ||
    !record.result.folds[0]?.test?.runHash
  )
    throw new Error('并发数改变数值或缺少独立测试结果');
  const completedTrades =
    record.result.folds[0].test.metrics?.completedTrades ?? 0;
  if (completedTrades < 1) throw new Error('压力样本缺少已完成交易');
  const exporting = performance.now();
  const { file } = await advancedTask({
    kind: 'export',
    record,
    format: 'json',
  }).promise;
  const exported = performance.now();
  const a = document.createElement('a');
  a.download = 'advanced-capacity.json';
  a.href = URL.createObjectURL(file);
  a.click();
  return {
    workers,
    completedTrades,
    evaluations: plan.bars,
    serialMs: joined - begin,
    poolMs: ran - joined,
    cancelMs,
    exportMs: exported - exporting,
    hash: record.reportHash,
    bytes: file.size,
  };
}
async function restore() {
  const file = document.querySelector('input')?.files?.[0];
  if (!file) throw new Error('缺少研究文件');
  const stop = responsiveness();
  try {
    const begin = performance.now();
    const { record } = await advancedTask({ kind: 'import', file }).promise;
    return {
      hash: record.reportHash,
      restoreMs: performance.now() - begin,
      ...stop(),
    };
  } finally {
    stop();
  }
}
Object.assign(globalThis, {
  runAdvancedCapacity: run,
  restoreAdvancedCapacity: restore,
});
