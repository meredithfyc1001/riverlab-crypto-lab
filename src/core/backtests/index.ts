import type { ModuleBoundary } from '../../shared/module';

export const backtestsBoundary: ModuleBoundary = {
  id: 'backtests',
  label: '回测',
  responsibility: '确定性事件驱动、模拟成交与逐笔账本；不连接交易账户。',
};
