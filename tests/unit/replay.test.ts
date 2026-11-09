import { describe, expect, it } from 'vitest';
import { ReplaySession, assertReplayCheckpoint } from '../../src/core/replay';
import { runBacktest, createBacktestSession } from '../../src/core/backtests';
import type { BacktestInput } from '../../src/core/backtests';
import { contentHash } from '../../src/core/backtests/identity';
import { market, START, INTERVAL } from '../fixtures/backtest';
import { fixtureDataset } from '../fixtures/dataset';
import ref from '../fixtures/replay-reference.json';
import baseline from '../fixtures/replay-engine-reference.json';
const metadata = {
  id: 'replay-1',
  name: '人工合成手工参考',
  createdUtcMs: START,
};
const session = () => new ReplaySession(market(ref.opens));
describe('shared engine and replay accounting', () => {
  it.each(baseline)(
    'preserves merged Phase3 complete engine output hash: $name',
    ({ input, resultHash }) => {
      expect(contentHash(runBacktest(input as unknown as BacktestInput))).toBe(
        resultHash,
      );
    },
  );
  it('matches independent Decimal ledger at every revealed close, with net=realized+open', () => {
    const s = session(),
      equities: string[] = [];
    for (let i = 0; i < ref.opens.length; i++) {
      s.advance();
      equities.push(s.view().account.equity);
      if (i === 0) s.trade('buy', '1');
      if (i === 2) s.trade('sell', 'all');
      if (i === 3) s.trade('buy', '2');
    }
    expect(equities).toEqual(ref.equities);
    const v = s.view();
    expect(v.account.cash).toBe(ref.cash);
    expect(v.account.position.quantity).toBe(ref.quantity);
    expect(v.account.equity).toBe(ref.equity);
    expect(v.statistics.realizedPnl).toBe(ref.realized);
    expect(v.statistics.unrealizedPnl).toBe(ref.unrealized);
    expect(v.statistics.netPnl).toBe(ref.net);
    expect(v.statistics.fees).toBe(ref.fees);
    expect(v.statistics.completedTradeCount).toBe(1);
    expect(v.statistics.winRate.value).toBe('0');
    expect(v.statistics.profitFactor.value).toBe('0');
    expect(v.statistics.annualizedReturn.value).toBeNull();
    expect(v.pending).toBeNull();
    expect(() => s.trade('buy', 'all')).toThrow('末根');
  });
  it('submits after close without changing balances, fills only on next advance and allows one decision per close', () => {
    const s = session();
    s.advance();
    const before = s.view();
    s.trade('buy', '1');
    const queued = s.view(1);
    expect(queued.account).toEqual(before.account);
    expect(queued.pending?.targetCandleIndex).toBe(1);
    expect(queued.fills).toEqual([]);
    expect(queued.candles).toEqual([]);
    expect(queued.curve).toEqual([]);
    expect(() => s.trade('sell', '1')).toThrow('one decision');
    s.advance();
    expect(s.view().fillCount).toBe(1);
  });
  it('changing hidden future prices cannot change revealed prices, fills, snapshots or statistics', () => {
    const a = market([100, 101, 102, 987654.321, 90]),
      b = structuredClone(a);
    b.candles = b.candles.map((c, i) =>
      i < 3
        ? c
        : {
            ...c,
            open: c.open * 2,
            high: c.high * 2,
            low: c.low * 2,
            close: c.close * 2,
          },
    );
    const first = new ReplaySession(a),
      second = new ReplaySession(b);
    for (const s of [first, second]) {
      s.advance();
      s.trade('buy', '1');
      s.advance(2);
    }
    const x = first.view(),
      y = second.view();
    for (const key of [
      'candles',
      'curve',
      'account',
      'fills',
      'orders',
      'statistics',
    ] as const)
      expect(x[key]).toEqual(y[key]);
    expect(JSON.stringify(x)).not.toContain('987654.321');
    expect(JSON.stringify(first.checkpoint(metadata))).not.toContain(
      '987654.321',
    );
  });
  it('restores an order queued at the current close exactly once, including fees, notes and future protection', () => {
    const d = market([100, 100, 80, 120, 100]);
    const a = new ReplaySession(d, undefined, {
      stopLossBps: 1000,
      takeProfitBps: 1000,
    });
    a.advance();
    a.trade('buy', '1');
    a.note('首根决策');
    const saved = a.checkpoint(metadata);
    const b = ReplaySession.restore(d, JSON.parse(JSON.stringify(saved)));
    expect(b.view()).toEqual(a.view());
    a.advance();
    b.advance();
    a.trade('sell', 'all');
    b.trade('sell', 'all');
    const afterQueue = ReplaySession.restore(d, a.checkpoint(metadata));
    a.advance();
    afterQueue.advance();
    expect(afterQueue.view()).toEqual(a.view());
    expect(a.view().orders.at(-1)?.status).toBe('cancelled');
    a.advance(50000);
    afterQueue.advance(50000);
    expect(afterQueue.checkpoint(metadata)).toEqual(a.checkpoint(metadata));
  });
  it('preserves conservative ambiguous stop-first and unknown intrabar time', () => {
    const d = market([100, 100, 100]);
    d.candles[1] = { ...d.candles[1], high: 120, low: 80 };
    const s = new ReplaySession(
      d,
      { feeBps: 0, buySlippageBps: 0, sellSlippageBps: 0 },
      { stopLossBps: 1000, takeProfitBps: 1000 },
    );
    s.advance();
    s.trade('buy', '1');
    s.advance();
    const f = s.view().fills.at(-1)!;
    expect(f.reason).toBe('stop-loss');
    expect(f.trigger?.assumption).toBe('ambiguous-stop-first');
    expect(f.timestampUtcMs).toBeNull();
    expect(f.price).toBe('90');
  });
  it('refuses unaffordable/short quantities through original rejection events without negative cash/position', () => {
    const s = session();
    s.advance();
    s.trade('buy', '1000');
    s.advance();
    expect(s.view().orders.at(-1)?.reason).toBe('insufficient-cash');
    expect(s.view().account.cash).toBe('1000');
    s.trade('sell', '1');
    s.advance();
    expect(s.view().orders.at(-1)?.reason).toBe('insufficient-position');
    expect(s.view().account.position.quantity).toBe('0');
    const before = s.view().stateHash;
    expect(() => s.trade('buy', '-1')).toThrow();
    expect(s.view().stateHash).toBe(before);
  });
  it('reports cold/no-trade NA and isolates caller mutations', () => {
    const d = market([100, 101, 102]);
    const s = new ReplaySession(d);
    s.advance();
    const before = s.view();
    d.candles[0] = { ...d.candles[0], close: 999 };
    expect(s.view()).toEqual(before);
    expect(before.statistics.winRate.value).toBeNull();
    expect(before.statistics.profitFactor.value).toBeNull();
    expect(before.statistics.annualizedReturn.value).toBeNull();
  });
  it('reconstructs all deltas without leaking a later candle or replaying an earlier candle twice', () => {
    const s = session();
    s.advance();
    const first = s.view();
    s.advance(2);
    const second = s.view(first.cursor);
    expect([...first.candles, ...second.candles]).toHaveLength(3);
    expect([...first.curve, ...second.curve]).toHaveLength(4);
    expect(second.candles.at(-1)!.timestampUtcMs).toBe(START + 2 * INTERVAL);
    expect(() => s.view(4)).toThrow();
    expect(() => s.advance(0)).toThrow();
  });
  it('rejects corrupt, rehashed-tampered, different-source, missing/version-invalid and unconfirmed data', () => {
    const d = market(ref.opens),
      s = new ReplaySession(d);
    s.advance(3);
    const saved = s.checkpoint(metadata);
    const bad = structuredClone(saved);
    bad.payload.cursor++;
    expect(() => ReplaySession.restore(d, bad)).toThrow('校验');
    bad.payloadHash = contentHash(bad.payload);
    expect(() => ReplaySession.restore(d, bad)).toThrow('重算');
    const changed = structuredClone(d);
    changed.id = 'other';
    expect(() => ReplaySession.restore(changed, saved)).toThrow('身份');
    const version = structuredClone(saved);
    version.payload.version = 'new' as typeof saved.payload.version;
    version.payloadHash = contentHash(version.payload);
    expect(() => ReplaySession.restore(d, version)).toThrow('版本');
    expect(() => assertReplayCheckpoint({})).toThrow();
    expect(() => new ReplaySession(fixtureDataset(true))).toThrow('gap');
    const pending = market(ref.opens);
    pending.warningsAcknowledged = false as unknown as true;
    expect(() => new ReplaySession(pending)).toThrow('确认');
  });
  it('protects journal limits and CSV formulas; saved JSON includes no candles and original dataset is not modified', () => {
    const d = market(ref.opens),
      before = JSON.stringify(d),
      s = new ReplaySession(d);
    s.advance();
    s.note('=HYPERLINK("unsafe")');
    s.note('中文,空格\n换行');
    const csv = s.csv();
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain('仅供学习研究，历史表现不代表未来表现');
    expect(csv).toContain('中文,空格');
    expect(() => s.note('')).toThrow();
    expect(() => s.note('a'.repeat(2001))).toThrow();
    const record = s.checkpoint(metadata);
    expect(record.payload).not.toHaveProperty('candles');
    expect(record.payload).not.toHaveProperty('result');
    expect(JSON.stringify(d)).toBe(before);
    for (let i = 2; i < 1000; i++) s.note('note');
    expect(() => s.note('over')).toThrow('1000');
  });
  it('execution session closes only at end; repeated finish is idempotent and scripted mode cannot accept interactive orders', () => {
    const d = market([100, 101]);
    const s = createBacktestSession({
      dataset: d,
      signals: [],
      completedThroughUtcMs: START + 2 * INTERVAL,
    });
    expect(() => s.finish()).toThrow();
    s.advance();
    expect(() =>
      s.submit({
        candleIndex: 0,
        action: 'buy',
        quantity: '1',
        reason: 'manual-buy',
      }),
    ).toThrow();
    s.advance();
    expect(s.finish()).toEqual(s.finish());
    expect(() => s.advance()).toThrow();
  });
});
