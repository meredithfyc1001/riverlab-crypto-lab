import { describe, expect, it } from 'vitest';
import { runResearch, verifyResearch, parameterGrid, planWindows, validateResearch, researchCsv } from '../../src/core/research';
import type { ResearchInput } from '../../src/core/research';
import { runBacktest } from '../../src/core/backtests';
import { calculateStatistics } from '../../src/core/statistics';
import { contentHash } from '../../src/core/backtests/identity';
import reference from '../fixtures/research-reference.json';
import { market, START, INTERVAL } from '../fixtures/backtest';

const example = (): ResearchInput => ({
  dataset: market(reference.prices), completedThroughUtcMs: START + reference.prices.length * INTERVAL,
  candidates: [{kind:'breakout',lookback:1}], evaluation:{kind:'full'},
  config:{feeBps:0,buySlippageBps:0,sellSlippageBps:0,quantityDecimals:0},
});
describe('Phase 3 deterministic independent windows', () => {
  it('matches independent fixed Decimal reference including realized/open pnl, drawdown and passive benchmark', () => {
    const r = runResearch(example()).rows[0], s = r.statistics;
    expect(r.final.cash).toBe(reference.finalCash);
    expect(r.final.position.quantity).toBe(reference.finalQuantity);
    expect(r.final.equity).toBe(reference.finalEquity);
    for (const key of ['netPnl','realizedPnl','unrealizedPnl','completedTradeCount'] as const) expect(s[key]).toBe(reference[key]);
    expect(s.totalReturn.value).toBe(reference.totalReturn);
    expect(s.maxDrawdown.value).toBe(reference.maxDrawdown);
    expect(s.winRate.value).toBe(reference.winRate);
    expect(s.profitFactor.value).toBeNull();
    expect(s.profitFactor.reason).toContain('分母为0');
    expect(s.benchmark.return.value).toBe(reference.benchmarkReturn);
    expect(s.annualizedReturn.value).toBeNull();
  });
  it('matches the original engine/statistics with nonzero fees/slippage/protection for all three strategies', () => {
    const input = example();
    input.candidates = [{kind:'ma',fastPeriod:1,slowPeriod:2},{kind:'rsi',period:2,lower:40,upper:60},{kind:'breakout',lookback:1}];
    input.config = {feeBps:10,buySlippageBps:7,sellSlippageBps:9};
    input.risk = {stopLossBps:500,takeProfitBps:700};
    for (const row of runResearch(input).rows) {
      const result = runBacktest({...input,strategy:row.strategy});
      const {curve,completedTrades,...stats} = calculateStatistics(result,String(reference.prices[0]));
      void curve;
      expect(row.final).toEqual(result.final);
      expect(row.runHash).toBe(result.manifest.runHash);
      expect(row.statistics).toEqual({...stats,completedTradeCount:completedTrades.length});
    }
  });
  it('strictly separates chronological samples, resets positions/indicators and expires boundary signals', () => {
    const input = {...example(),evaluation:{kind:'split' as const,trainBars:4}};
    const rows = runResearch(input).rows;
    expect(rows.map(r => r.final.equity)).toEqual([reference.trainEquity,reference.testEquity]);
    expect(rows[0].endUtcMs).toBe(rows[1].startUtcMs);
    expect(rows[0].window.end - 1).toBeLessThan(rows[1].window.start);
    expect(rows[1].statistics.completedTradeCount).toBe(0);
    expect(rows[1].statistics.winRate.value).toBeNull();
  });
  it('changing future test prices cannot change training outputs or candidate parameters', () => {
    const input = {...example(),evaluation:{kind:'split' as const,trainBars:4}};
    const before = runResearch(input);
    input.dataset.candles.slice(4).forEach(c => { c.open *= 2; c.high *= 2; c.low *= 2; c.close *= 2; });
    const after = runResearch(input);
    expect(after.rows[0]).toEqual(before.rows[0]);
    expect(after.input.candidates).toEqual(before.input.candidates);
    expect(after.rows[1].dataHash).not.toBe(before.rows[1].dataHash);
  });
  it('rolling tests do not overlap; trailing incomplete windows are explicit and no compounding is invented', () => {
    const input = example();
    input.evaluation = {kind:'rolling',trainBars:3,testBars:2};
    const report = runResearch(input);
    expect(report.rows.map(r => [r.window.role,r.window.start,r.window.end])).toEqual([['train',0,3],['test',3,5],['train',2,5],['test',5,7]]);
    expect(Math.max(...report.rows.map(r=>r.window.end))).toBe(7);
    expect(report).not.toHaveProperty('combinedReturn');
    expect(report.rows.every(r=>r.statistics.annualizedReturn.value===null)).toBe(true);
  });
  it('retains cold-start insufficient-sample warnings and NA trade statistics', () => {
    const input=example(); input.candidates=[{kind:'ma',fastPeriod:2,slowPeriod:30}];
    const row=runResearch(input).rows[0];
    expect(row.warning).toContain('样本不足');
    expect(row.statistics.winRate.value).toBeNull();
    expect(row.statistics.profitFactor.value).toBeNull();
    expect(row.final.equity).toBe('1000');
  });
  it('produces exactly reproducible reports; export includes all inputs and disclaimer; tampering fails', () => {
    const input=example(), first=runResearch(input), second=runResearch(input);
    expect(second).toEqual(first);
    expect(verifyResearch(JSON.parse(JSON.stringify(first)))).toEqual(first);
    expect(researchCsv(first)).toContain(first.payloadHash);
    expect(researchCsv(first)).toContain('仅供学习研究，历史表现不代表未来表现');
    const tampered=structuredClone(first); tampered.rows[0].final.cash='999';
    expect(()=>verifyResearch(tampered)).toThrow('校验');
    const {payloadHash,...payload}=tampered; void payloadHash;
    tampered.payloadHash=contentHash(payload);
    expect(()=>verifyResearch(tampered)).toThrow('复现');
    input.dataset.candles[0].close=105;
    expect(first.input.dataset.candles[0].close).toBe(100);
  });
  it('validates the full original dataset, including unused tail, before any subrun', () => {
    const input=example(); input.evaluation={kind:'rolling',trainBars:3,testBars:2};
    input.dataset.candles[7].open=NaN;
    const progress: number[]=[];
    expect(()=>runResearch(input,n=>progress.push(n))).toThrow();
    expect(progress).toEqual([]);
    const precision=example(); precision.dataset.candles.at(-1)!.low=1e-19;
    expect(()=>runResearch(precision)).toThrow('18');
    const unconfirmed=example(); unconfirmed.dataset.warningsAcknowledged=false as unknown as true;
    expect(()=>runResearch(unconfirmed)).toThrow('确认');
    const incomplete=example(); incomplete.completedThroughUtcMs--;
    expect(()=>runResearch(incomplete)).toThrow('未完成');
  });
  it('rejects duplicates, gaps, malformed grids, impossible windows and explicit resource excess', () => {
    expect(()=>parameterGrid('ma',[2,5],[4])).toThrow();
    expect(()=>parameterGrid('rsi',[20,20],[70])).toThrow();
    expect(()=>parameterGrid('rsi',[70],[30])).toThrow();
    expect(()=>parameterGrid('breakout',[NaN])).toThrow();
    expect(()=>parameterGrid('ma',[1,2,3,4,5,6],[7,8,9,10,11])).toThrow('25');
    expect(parameterGrid('rsi',[20,30],[70,80],3)).toHaveLength(4);
    expect(parameterGrid('breakout',[2,3])).toHaveLength(2);
    const input=example(); input.candidates.push({kind:'breakout',lookback:1});
    expect(()=>validateResearch(input)).toThrow('重复');
    expect(()=>planWindows(8,{kind:'split',trainBars:7})).toThrow();
    expect(()=>planWindows(100,{kind:'rolling',trainBars:2,testBars:2})).toThrow();
    const large=example(); large.dataset=market(Array.from({length:50000},()=>100)); large.completedThroughUtcMs=START+50000*INTERVAL;
    large.candidates=parameterGrid('breakout',Array.from({length:21},(_,i)=>i+1));
    expect(()=>validateResearch(large)).toThrow('预算');
    const gap=example();
    gap.dataset.candles.slice(4).forEach(c=>c.timestampUtcMs+=INTERVAL);
    gap.dataset.quality.range!.endUtcMs+=INTERVAL;
    gap.dataset.quality.gapCount=1; gap.dataset.quality.missingCandles=1;
    gap.dataset.quality.issueCounts.MISSING_CANDLES=1; gap.dataset.quality.warningCount++;
    gap.dataset.quality.issues.push({severity:'warning',code:'MISSING_CANDLES',message:'explicit gap'});
    expect(()=>runResearch(gap)).toThrow('缺口');
  });
});
