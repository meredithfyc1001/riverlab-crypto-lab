import { responsiveness } from '../responsiveness';
import {
  marketRegimeTask,
  type RegimeRunInput,
} from '../../../src/infrastructure/market-regime-worker';
import { workerTask } from '../../../src/infrastructure/backtest-worker';
import { ExperimentStore } from '../../../src/infrastructure/experiment-store';
import { sharedPoolTask } from '../../../src/infrastructure/shared-pool-worker';
import { SharedPoolStore } from '../../../src/infrastructure/shared-pool-store';
import { portfolioTask } from '../../../src/infrastructure/portfolio-worker';
import { PortfolioStore } from '../../../src/infrastructure/portfolio-store';
import { makeInput } from '../shared-pool/input';
import { prepareBacktest } from '../backtest-input';

type Mode = 'single' | 'portfolio' | 'shared-strategy' | 'rebalance';

async function saveSource(mode: Mode) {
  if (mode === 'single') {
    const response = await workerTask(await prepareBacktest()).promise;
    if (!('record' in response)) throw new Error('缺少单币实验');
    await new ExperimentStore().save(response.record);
    return {
      sourceKind: 'single' as const,
      sourceId: response.record.id,
      expectedHash: response.record.payloadHash,
      reference: null,
    };
  }
  const input = await makeInput(
    mode === 'rebalance' ? 5 : 2,
    mode === 'rebalance' ? mode : 'shared-strategy',
  );
  const reference = input.assets[1].dataset.symbol;
  if (mode === 'portfolio' && input.mode === 'shared-strategy') {
    const portfolio = {
      initialCash: input.initialCash,
      quoteCurrency: input.quoteCurrency,
      startUtcMs: input.startUtcMs,
      endUtcMs: input.endUtcMs,
      completedThroughUtcMs: input.completedThroughUtcMs,
      rangeConfirmed: input.rangeConfirmed,
      assets: input.assets.map((a) => ({ ...a, weightPercent: '50' })),
    };
    const { record } = await portfolioTask({
      kind: 'run',
      input: portfolio,
      name: '固定子账户容量样本',
    }).promise;
    await new PortfolioStore().save(record);
    return {
      sourceKind: 'portfolio' as const,
      sourceId: record.id,
      expectedHash: record.payloadHash,
      reference,
    };
  }
  const { record } = await sharedPoolTask({
    kind: 'run',
    input,
    name: '共享组合容量样本',
  }).promise;
  await new SharedPoolStore().save(record);
  return {
    sourceKind: 'shared' as const,
    sourceId: record.id,
    expectedHash: record.payloadHash,
    reference,
  };
}

async function run(mode: Mode) {
  const input: RegimeRunInput = {
    ...(await saveSource(mode)),
    params: { lookback: 1, thresholdBps: 5 },
  };
  const stop = responsiveness();
  try {
    const first = marketRegimeTask({ kind: 'run', input, name: '满载取消' });
    const start = performance.now();
    const handle = setTimeout(() => first.cancel(), 20);
    try {
      await first.promise;
      throw new Error('取消前已意外完成');
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('已取消'))
        throw error;
    } finally {
      clearTimeout(handle);
    }
    const cancelled = performance.now();
    const { record } = await marketRegimeTask({
      kind: 'run',
      input,
      name: '市场状态容量样本',
    }).promise;
    const ran = performance.now();
    const { file } = await marketRegimeTask({
      kind: 'export',
      record,
      format: 'json',
    }).promise;
    const exported = performance.now();
    const a = document.createElement('a');
    a.download = 'market-regime.json';
    a.href = URL.createObjectURL(file);
    a.click();
    return {
      mode,
      bars: record.result.labels.length,
      hash: record.reportHash,
      bytes: file.size,
      netPnl: record.result.netPnl,
      fills: record.result.summaries.reduce((n, s) => n + s.fills, 0),
      switches: record.result.switches,
      cancelMs: Math.round(cancelled - start),
      runMs: Math.round(ran - cancelled),
      exportMs: Math.round(exported - ran),
      ...stop(),
    };
  } finally {
    stop();
  }
}

async function restore() {
  const file = document.querySelector('input')?.files?.[0];
  if (!file) throw new Error('缺少待恢复文件');
  const stop = responsiveness();
  const begin = performance.now();
  try {
    const { record } = await marketRegimeTask({ kind: 'import', file }).promise;
    return {
      hash: record.reportHash,
      bars: record.result.labels.length,
      netPnl: record.result.netPnl,
      restoreMs: Math.round(performance.now() - begin),
      ...stop(),
    };
  } finally {
    stop();
  }
}

Object.assign(globalThis, {
  runRegimeSample: run,
  restoreRegimeSample: restore,
});
