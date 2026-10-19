import { describe, expect, it } from 'vitest';
import { calculateIndicators } from '../../src/core/indicators';
import type { Candle } from '../../src/core/data';
import reference from '../fixtures/indicator-reference.json';
const candles = (closes: number[]): Candle[] =>
  closes.map((close, i) => ({
    timestampUtcMs: 1735689600000 + i * 60000,
    open: close,
    high: close,
    low: close,
    close,
    volume: 0,
  }));
const periods = { ma: 14, ema: 14, rsi: 14 };
describe('纯指标：固定独立数值与因果性', () => {
  it.each(['ma', 'ema', 'rsi'] as const)(
    '%s 与 Decimal 60 位闭式参考的每一点一致',
    (key) => {
      const result = calculateIndicators(
        candles(reference.closes),
        60000,
        periods,
      )[key];
      reference[key].forEach((value, i) =>
        value === null
          ? expect(result[i].value).toBeNull()
          : expect(result[i].value).toBeCloseTo(value, 10),
      );
      expect(result[0].timestampUtcMs).toBe(1735689600000);
    },
  );
  it('Wilder 首个 RSI 使用 N 个差值，即第 N+1 根', () => {
    const result = calculateIndicators(
      candles(reference.closes),
      60000,
      periods,
    );
    expect(result.rsi[13].value).toBeNull();
    expect(result.rsi[14].value).toBeCloseTo(70.46413502109705, 10);
    expect(result.ema[12].value).toBeNull();
    expect(result.ema[13].value).toBeCloseTo(45.114285714285714, 10);
  });
  it('添加或任意修改未来 K 线不改变历史结果', () => {
    const all = calculateIndicators(candles(reference.closes), 60000, periods);
    for (let length = 1; length <= reference.closes.length; length++) {
      const partial = calculateIndicators(
        candles(reference.closes.slice(0, length)),
        60000,
        periods,
      );
      for (const key of ['ma', 'ema', 'rsi'] as const)
        expect(partial[key]).toEqual(all[key].slice(0, length));
    }
    const changed = calculateIndicators(
      candles([...reference.closes.slice(0, 20), 99999, 1]),
      60000,
      periods,
    );
    expect(changed.rsi.slice(0, 20)).toEqual(all.rsi.slice(0, 20));
  });
  it.each([
    [1, 2, 3, 4, 5],
    [5, 4, 3, 2, 1],
    [3, 3, 3, 3, 3],
  ])('上升、下降、常量 RSI 边界：%j', (...values) => {
    const p = values as number[];
    const result = calculateIndicators(candles(p), 60000, {
      ma: 1,
      ema: 1,
      rsi: 1,
    });
    expect(result.ma.map((p) => p.value)).toEqual(p);
    expect(result.ema.map((p) => p.value)).toEqual(p);
    expect(result.rsi[0].value).toBeNull();
    expect(result.rsi.at(-1)!.value).toBe(
      p[0] === p[1] ? 50 : p[1] > p[0] ? 100 : 0,
    );
  });
  it('空数据、单根与周期大于样本不伪造数值', () => {
    expect(calculateIndicators([], 60000, periods)).toEqual({
      ma: [],
      ema: [],
      rsi: [],
    });
    const result = calculateIndicators(candles([10]), 60000, periods);
    expect(result.rsi[0].value).toBeNull();
    expect(result.ma[0].value).toBeNull();
    expect(result.ema[0].value).toBeNull();
  });
  it('缺口重置所有预热状态，保持时间和值的位置', () => {
    const input = candles([10, 11, 12, 13, 14, 15]);
    for (let i = 3; i < input.length; i++)
      input[i] = {
        ...input[i],
        timestampUtcMs: input[i].timestampUtcMs + 60000,
      };
    const result = calculateIndicators(input, 60000, { ma: 2, ema: 2, rsi: 2 });
    expect(result.ma.map((p) => p.value)).toEqual([
      null,
      10.5,
      11.5,
      null,
      13.5,
      14.5,
    ]);
    expect(result.ema[3].value).toBeNull();
    expect(result.rsi[4].value).toBeNull();
    expect(result.rsi[5].value).toBe(100);
  });
  it.each([0, -1, 1.5, 50001, NaN, Infinity])(
    '非法周期 %s 明确报错',
    (period) => {
      expect(() =>
        calculateIndicators(candles([10, 11]), 60000, {
          ma: period,
          ema: 2,
          rsi: 2,
        }),
      ).toThrow('周期');
    },
  );
  it('非法输入与重复/倒序时间明确拒绝', () => {
    expect(() => calculateIndicators(candles([NaN]), 60000, periods)).toThrow(
      '非法价格',
    );
    const input = candles([1, 2]);
    input[1] = { ...input[1], timestampUtcMs: input[0].timestampUtcMs };
    expect(() => calculateIndicators(input, 60000, periods)).toThrow(
      '异常时间戳',
    );
    expect(() => calculateIndicators([], 0, periods)).toThrow('周期');
  });
  it('极大但有限的常量价格不因累加溢出产生 Infinity', () => {
    const result = calculateIndicators(
      candles([1e308, 1e308, 1e308, 1e308]),
      60000,
      { ma: 2, ema: 2, rsi: 2 },
    );
    expect(result.ma.at(-1)!.value).toBe(1e308);
    expect(result.ema.at(-1)!.value).toBe(1e308);
    expect(result.rsi.at(-1)!.value).toBe(50);
  });
});
