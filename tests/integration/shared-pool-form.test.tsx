import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { summarizeDataset } from '../../src/core/data/dataset';
import PortfolioCenter from '../../src/features/portfolio/PortfolioCenter';
import { INTERVAL, START, market } from '../fixtures/backtest';

it('再平衡缩短运行区间仍确认全部源行情，且不提交隐藏的规则或保护参数', () => {
  const state = {
    record: null,
    records: [],
    saved: false,
    busy: false,
    canCancel: false,
    message: '',
    error: '',
    run: vi.fn(),
    restore: vi.fn(),
    open: vi.fn(),
    save: vi.fn(),
    remove: vi.fn(),
    reproduce: vi.fn(),
    exportRecord: vi.fn(),
    cancel: vi.fn(),
  };
  const runShared = vi.fn();
  const datasets = [
    summarizeDataset({
      ...market([10, 11, 12, 13, 14]),
      id: 'aaa',
      symbol: 'AAA/USDT',
    }),
    summarizeDataset({
      ...market([20, 21, 22, 23]),
      id: 'bbb',
      symbol: 'BBB/USDT',
    }),
  ];
  render(
    <PortfolioCenter
      datasets={datasets}
      rules={[]}
      ruleError=""
      workbench={state}
      sharedWorkbench={{ ...state, run: runShared }}
      theme="dark"
    />,
  );
  const change = (input: HTMLElement, value: string) =>
    fireEvent.change(input, { target: { value } });
  change(screen.getByLabelText('运行模式'), 'shared-strategy');
  for (const [i, dataset] of datasets.entries()) {
    const asset = within(
      screen.getByRole('group', { name: '资产 ' + (i + 1) }),
    );
    change(asset.getByLabelText('历史数据集'), dataset.id);
    change(asset.getByLabelText('策略类型'), 'rules');
  }
  change(screen.getByLabelText('运行模式'), 'rebalance');
  expect(screen.queryByLabelText('策略类型')).not.toBeInTheDocument();
  change(
    screen.getByLabelText('末根开盘时间（UTC 毫秒）'),
    String(START + 2 * INTERVAL),
  );
  fireEvent.click(screen.getByLabelText(/我确认共同区间/));
  fireEvent.click(screen.getByRole('button', { name: '运行组合回测' }));
  expect(state.run).not.toHaveBeenCalled();
  expect(runShared).toHaveBeenCalledTimes(1);
  expect(runShared.mock.calls[0][0]).toMatchObject({
    mode: 'rebalance',
    startUtcMs: START,
    endUtcMs: START + 2 * INTERVAL,
    completedThroughUtcMs: START + 5 * INTERVAL,
    cashWeightPercent: '0',
    rebalanceEvery: 1,
  });
  for (const asset of runShared.mock.calls[0][0].assets) {
    expect(Object.keys(asset).sort()).toEqual([
      'costs',
      'dataset',
      'weightPercent',
    ]);
  }
});
