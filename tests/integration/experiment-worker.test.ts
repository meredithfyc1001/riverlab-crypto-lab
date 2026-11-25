import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useBacktestWorkbench } from '../../src/app/useBacktestWorkbench';
import { ExperimentStore } from '../../src/infrastructure/experiment-store';
import type { WorkerResponse } from '../../src/infrastructure/backtest-worker';
import type { Experiment } from '../../src/core/experiments';
import fixture from '../fixtures/windows-20261125/rules-v2.json';

class ControlledWorker {
  static latest: ControlledWorker;
  onmessage?: (event: { data: WorkerResponse }) => void;
  onerror?: () => void;
  onmessageerror?: () => void;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    ControlledWorker.latest = this;
  }
}
const file = new File(['{}'], 'report.json');
const record = fixture as Experiment;
beforeEach(() => {
  vi.stubGlobal('Worker', ControlledWorker);
  vi.spyOn(ExperimentStore.prototype, 'list').mockResolvedValue([]);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('已取消的回测 Worker 即使迟到也不能替换新预览或写库', async () => {
  const save = vi.spyOn(ExperimentStore.prototype, 'save');
  const { result } = renderHook(useBacktestWorkbench);
  act(() => result.current.importFile(file));
  const old = ControlledWorker.latest;
  act(() => result.current.cancel());
  expect(old.terminate).toHaveBeenCalled();
  act(() => result.current.importFile(file));
  const current = ControlledWorker.latest;
  await act(async () => {
    old.onmessage!({ data: { ok: true, record } });
  });
  expect(result.current.preview).toBeNull();
  expect(result.current.busy).toBe(true);
  await act(async () => {
    current.onmessage!({ data: { ok: true, record } });
  });
  expect(result.current.preview).toBe(record);
  expect(result.current.busy).toBe(false);
  expect(save).not.toHaveBeenCalled();
});

it.each(['onerror', 'onmessageerror'] as const)(
  'Worker %s 终止任务且不显示部分结果，支持再次导入',
  async (failure) => {
    const { result } = renderHook(useBacktestWorkbench);
    act(() => result.current.importFile(file));
    const failed = ControlledWorker.latest;
    await act(async () => failed[failure]!());
    expect(failed.terminate).toHaveBeenCalled();
    expect(result.current.busy).toBe(false);
    expect(result.current.preview).toBeNull();
    expect(result.current.error).toContain('Worker');
    act(() => result.current.importFile(file));
    await act(async () => {
      ControlledWorker.latest.onmessage!({ data: { ok: true, record } });
    });
    expect(result.current.preview).toBe(record);
    expect(result.current.error).toBe('');
  },
);
