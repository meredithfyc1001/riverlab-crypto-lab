import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzeCsv, inspectCsv } from '../../src/core/data';
import { DatasetCenter } from '../../src/features/datasets/DatasetCenter';
import { startCsvJob } from '../../src/features/datasets/worker-client';
import type {
  CsvJob,
  CsvResult,
} from '../../src/features/datasets/worker-types';

vi.mock('../../src/features/datasets/worker-client', () => ({
  startCsvJob: vi.fn(),
}));
function resultFromText(text: string, request: CsvJob): CsvResult {
  const identity = {
    name: request.file.name,
    bytes: request.file.size,
    sha256: 'test-fixture-digest',
    parserVersion: 'csv-v1' as const,
  };
  if (!request.options)
    return {
      kind: 'inspection',
      identity,
      inspection: inspectCsv(text, request.settings),
    };
  const { candles, ...report } = analyzeCsv(text, request.options);
  expect(candles.length).toBe(report.validRows);
  return { kind: 'report', identity, report };
}
beforeEach(() => {
  vi.mocked(startCsvJob).mockReset();
  vi.mocked(startCsvJob).mockImplementation((request) => ({
    cancel: vi.fn(),
    promise: new Promise<CsvResult>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () =>
        resolve(resultFromText(String(reader.result), request));
      reader.onerror = reject;
      reader.readAsText(request.file);
    }),
  }));
});

describe('数据中心确认与报告', () => {
  it('合成微秒样本先确认周期，再生成报告；修改约定使旧报告失效', async () => {
    const user = userEvent.setup();
    render(<DatasetCenter />);
    await user.click(
      screen.getByRole('button', { name: '人工合成样本 · 微秒' }),
    );
    await screen.findByText('读到 4 条数据记录。', { exact: false });
    await user.click(
      screen.getByRole('button', { name: '检查并生成导入报告' }),
    );
    await screen.findByRole('heading', { name: '数据质量报告' });
    expect(screen.getByText('us → UTC 毫秒')).toBeVisible();
    expect(screen.getByText('需要确认：预期周期')).toBeVisible();
    await user.click(
      screen.getByRole('button', { name: /采用建议周期 60 秒/ }),
    );
    expect(
      screen.queryByRole('heading', { name: '数据质量报告' }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: '检查并生成导入报告' }),
    );
    await screen.findByText('检查完成（仅文件内）');
    expect(screen.getByText('60 秒（固定周期）')).toBeVisible();
    expect(screen.getByText(/不代表原生交易所微秒数据/)).toBeVisible();
    await user.selectOptions(screen.getByLabelText('时间单位'), 'ms');
    expect(
      screen.queryByRole('heading', { name: '数据质量报告' }),
    ).not.toBeInTheDocument();
  });

  it('用户文件支持手动映射和显式时间单位，不把自述来源认证为真实', async () => {
    const user = userEvent.setup();
    render(<DatasetCenter />);
    const file = new File(
      ['t,p,h,l,c,v\n0,100,104,99,102,20\n60000,102,104,99,101,20'],
      'custom.csv',
      { type: 'text/csv' },
    );
    await user.upload(screen.getByLabelText('选择本地 CSV'), file);
    await screen.findByText('读到 2 条数据记录。', { exact: false });
    for (const [label, index] of [
      ['时间戳列', '0'],
      ['开盘价列', '1'],
      ['最高价列', '2'],
      ['最低价列', '3'],
      ['收盘价列', '4'],
      ['成交量列', '5'],
    ])
      await user.selectOptions(screen.getByLabelText(label), index);
    await user.type(screen.getByLabelText('预期固定周期（秒）'), '60');
    await user.click(
      screen.getByRole('button', { name: '检查并生成导入报告' }),
    );
    await screen.findByText('需要确认：时间单位');
    await user.selectOptions(screen.getByLabelText('时间单位'), 'ms');
    await user.click(
      screen.getByRole('button', { name: '检查并生成导入报告' }),
    );
    await screen.findByText('检查完成（仅文件内）');
    expect(screen.getByText('用户文件 · 来源未核实')).toBeVisible();
    expect(screen.getByText(/1970-01-01 00:00:00.000 UTC 至/)).toBeVisible();
  });

  it('错误样本显示阻断、重复、缺口和错误行', async () => {
    const user = userEvent.setup();
    render(<DatasetCenter />);
    await user.click(
      screen.getByRole('button', { name: '错误测试样本 · 人工构造' }),
    );
    await screen.findByText('读到 9 条数据记录。', { exact: false });
    await user.type(screen.getByLabelText('预期固定周期（秒）'), '60');
    await user.click(
      screen.getByRole('button', { name: '检查并生成导入报告' }),
    );
    await screen.findByText('存在阻断错误');
    expect(screen.getAllByText('DUPLICATE_TIMESTAMP')).toHaveLength(2);
    expect(screen.getByText('MISSING_CANDLES')).toBeVisible();
    expect(screen.getByText('INVALID_OHLC')).toBeVisible();
    expect(screen.getByText('COLUMN_COUNT')).toBeVisible();
  });

  it('选择新文件后取消旧任务，迟到响应不能覆盖新来源或预览', async () => {
    const jobs: {
      request: CsvJob;
      resolve: (result: CsvResult) => void;
      cancel: ReturnType<typeof vi.fn>;
    }[] = [];
    vi.mocked(startCsvJob).mockImplementation((request) => {
      const cancel = vi.fn();
      return {
        cancel,
        promise: new Promise<CsvResult>((resolve) =>
          jobs.push({ request, resolve, cancel }),
        ),
      };
    });
    const user = userEvent.setup();
    render(<DatasetCenter />);
    const upload = screen.getByLabelText('选择本地 CSV');
    await user.upload(
      upload,
      new File(['old'], 'old.csv', { type: 'text/csv' }),
    );
    await user.upload(
      upload,
      new File(['new'], 'new.csv', { type: 'text/csv' }),
    );
    expect(jobs[0].cancel).toHaveBeenCalled();
    await act(async () => {
      jobs[1].resolve(resultFromText('new-col\n2', jobs[1].request));
    });
    await waitFor(() =>
      expect(screen.getByText('当前文件：new.csv')).toBeVisible(),
    );
    await act(async () => {
      jobs[0].resolve(resultFromText('old-col\n1', jobs[0].request));
    });
    expect(screen.queryByText('1 · old-col')).not.toBeInTheDocument();
    expect(screen.getByText('当前文件：new.csv')).toBeVisible();
  });
});
