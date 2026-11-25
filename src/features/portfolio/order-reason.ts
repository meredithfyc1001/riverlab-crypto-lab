import type { PoolOrder } from '../../core/shared-pool/types';

const rejections: Record<NonNullable<PoolOrder['rejection']>, string> = {
  'risk-priority': '同根保护订单优先',
  'cash-reserve': '扣除目标现金储备后无可用预算',
  'price-underflow': '成交价低于价格精度',
  'stop-price-underflow': '止损价向下取整后为零，入场订单已拒绝',
  'zero-quantity': '取整后数量为零',
  'zero-notional': '取整后成交额为零',
  'below-min-notional': '低于最小成交额',
  'insufficient-cash': '可用现金不足',
  'insufficient-position': '可用持仓不足',
  'position-already-open': '已持仓，本模式禁止加仓',
  'position-already-flat': '当前空仓',
};

export function rejectionText(code: string) {
  return Object.hasOwn(rejections, code)
    ? rejections[code as keyof typeof rejections]
    : code;
}
