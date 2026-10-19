import { describe, expect, it } from 'vitest';
import { syntheticExample } from '../../src/app/synthetic-example';

describe('合成示例的来源与数据约束', () => {
  it('明确声明合成来源且不会冒充真实币种行情', () => {
    expect(syntheticExample.source).toBe('synthetic');
    expect(syntheticExample.label).toContain('人工合成数据');
    expect(syntheticExample.label).toContain('DEMO/USDT');
    expect(syntheticExample.disclaimer).toContain('不是真实行情');
  });

  it('只包含严格递增的 UTC 毫秒时间及有效 OHLCV 样本', () => {
    const candles = syntheticExample.candles;
    expect(candles.length).toBeGreaterThan(0);
    candles.forEach((candle, index) => {
      expect(Number.isSafeInteger(candle.timestampUtcMs)).toBe(true);
      expect(new Date(candle.timestampUtcMs).getUTCFullYear()).toBe(2026);
      expect(candle.low).toBeLessThanOrEqual(
        Math.min(candle.open, candle.close),
      );
      expect(candle.high).toBeGreaterThanOrEqual(
        Math.max(candle.open, candle.close),
      );
      expect(candle.low).toBeGreaterThan(0);
      expect(candle.volume).toBeGreaterThanOrEqual(0);
      if (index > 0) {
        expect(candle.timestampUtcMs - candles[index - 1].timestampUtcMs).toBe(
          3_600_000,
        );
      }
    });
  });
});
