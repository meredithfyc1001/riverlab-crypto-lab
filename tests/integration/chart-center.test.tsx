import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChartCenter } from '../../src/features/charts/ChartCenter';
import { fixtureDataset } from '../fixtures/dataset';
describe('行情入口保护', () => {
  it('空数据明确引导导入，没有假图表', () => {
    render(<ChartCenter dataset={null} theme="dark" />);
    expect(
      screen.getByRole('heading', { name: '尚无可显示的数据' }),
    ).toBeVisible();
    expect(screen.queryByTestId('market-canvas')).not.toBeInTheDocument();
  });
  it('损坏 OHLC 数据在库调用前阻断，不排序/修复', () => {
    const d = fixtureDataset();
    d.candles[0] = { ...d.candles[0], close: Infinity };
    render(<ChartCenter dataset={d} theme="light" />);
    expect(screen.getByRole('alert')).toHaveTextContent('价格/量/UTC 时间非法');
    expect(screen.queryByTestId('market-canvas')).not.toBeInTheDocument();
  });
  it('异常时间戳在库调用前明确阻断', () => {
    const d = fixtureDataset();
    d.candles[1] = {
      ...d.candles[1],
      timestampUtcMs: d.candles[0].timestampUtcMs,
    };
    render(<ChartCenter dataset={d} theme="dark" />);
    expect(screen.getByRole('alert')).toHaveTextContent('重复、降序或周期不符');
    expect(screen.queryByTestId('market-canvas')).not.toBeInTheDocument();
  });
});
