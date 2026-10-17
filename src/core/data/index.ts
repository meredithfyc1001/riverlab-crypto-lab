import type { ModuleBoundary } from '../../shared/module';

export const dataBoundary: ModuleBoundary = {
  id: 'data',
  label: '数据',
  responsibility: '行情模型、来源与质量信息；导入解析在 Phase 1 实现。',
};

/** 内部时间统一为 UTC 毫秒；Phase 0 无外部数据解析。 */
export interface Candle {
  readonly timestampUtcMs: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
}

export interface SyntheticDataset {
  readonly id: string;
  readonly source: 'synthetic';
  readonly label: string;
  readonly disclaimer: string;
  readonly candles: readonly Candle[];
}
