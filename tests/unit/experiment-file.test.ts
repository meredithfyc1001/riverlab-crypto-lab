// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { contentHash } from '../../src/core/backtests/identity';
import { readExperimentFile } from '../../src/infrastructure/experiment-file';
import { runExperiment } from '../../src/core/experiments';
import type { Experiment } from '../../src/core/experiments';

const original = readFileSync(
  'tests/fixtures/windows-20261125/rules-v2.json',
  'utf8',
);
const source = () => JSON.parse(original) as Experiment & { format: string };
const read = (value: unknown) =>
  readExperimentFile(new Blob([JSON.stringify(value)]));

describe('实验 JSON 恢复文件边界', () => {
  it('使用独立的 Windows V2 导出，无需数据库或原策略库', async () => {
    const { format, ...record } = source();
    expect(format).toBe('riverlab-experiment');
    expect(await readExperimentFile(new Blob(['\ufeff', original]))).toEqual(
      record,
    );
  });
  it('空文件和超限文件均在读取前拒绝', async () => {
    for (const size of [0, 256 * 1024 * 1024 + 1]) {
      const file = new Blob();
      Object.defineProperty(file, 'size', { value: size });
      const read = vi.spyOn(file, 'arrayBuffer');
      await expect(readExperimentFile(file)).rejects.toThrow('为空或超过');
      expect(read).not.toHaveBeenCalled();
    }
  });
  it('拒绝非法 UTF-8 和截断的 JSON', async () => {
    for (const bytes of [new Uint8Array([0xc3, 0x28]), '{']) {
      await expect(readExperimentFile(new Blob([bytes]))).rejects.toThrow(
        'UTF-8 JSON',
      );
    }
  });
  it('拒绝缺少导出标识、未知字段和不支持的版本', async () => {
    const e = source();
    await expect(read({ ...e, format: undefined })).rejects.toThrow('格式');
    await expect(read({ ...e, format: 'riverlab-risk' })).rejects.toThrow(
      '格式',
    );
    await expect(read({ ...e, junk: true })).rejects.toThrow('未知字段');
    await expect(read({ ...e, schemaVersion: 2 })).rejects.toThrow(
      '版本不支持',
    );
  });
  it('完整重算一致仍拒绝未来收盘或携带未定义快照字段', async () => {
    for (const testCase of ['future', 'unknown']) {
      const e = source();
      const { dataset, result } = e.payload;
      const { config, risk, strategy, completedThroughUtcMs } = result.manifest;
      if (testCase === 'unknown')
        Object.assign(dataset.candles[0], { extra: true });
      e.payload = runExperiment({
        dataset,
        config,
        risk,
        strategy: strategy!.config,
        completedThroughUtcMs:
          testCase === 'future'
            ? Date.now() + 3_600_000
            : completedThroughUtcMs,
      });
      e.payloadHash = contentHash(e.payload);
      await expect(read(e)).rejects.toThrow(
        testCase === 'future' ? '收盘时间' : '未知字段',
      );
    }
  });
  it('拒绝错误摘要、修改统计后重新封存的文件和无效参数', async () => {
    const e = source();
    await expect(read({ ...e, payloadHash: '0'.repeat(64) })).rejects.toThrow(
      '校验和',
    );
    e.payload.statistics.netPnl = '0';
    e.payloadHash = contentHash(e.payload);
    await expect(read(e)).rejects.toThrow('重算结果不一致');
    e.payload.result.manifest.config.quantityDecimals = 19;
    e.payloadHash = contentHash(e.payload);
    await expect(read(e)).rejects.toThrow('Quantity precision');
  });
});
