import historical from './samples/real-btcusdt-2024-10-28.csv?raw';
import provenance from './samples/real-btcusdt.provenance.json';
import ms from './samples/synthetic-ms.csv?raw';
import us from './samples/synthetic-us.csv?raw';
import errors from './samples/error-cases.csv?raw';

export interface DataSource {
  kind: 'historical' | 'synthetic' | 'error-fixture' | 'user-unverified';
  label: string;
  note: string;
  url?: string;
  expectedSha256?: string;
}
export interface BuiltInSample {
  id: string;
  name: string;
  text: string;
  hasHeader: boolean;
  source: DataSource;
}
export const userSource: DataSource = {
  kind: 'user-unverified',
  label: '用户文件 · 来源未核实',
  note: '文件名和填写的来源说明不构成真实行情认证，请核对数据提供方、币种、市场与采集口径。',
};
export const samples: BuiltInSample[] = [
  {
    id: 'historical',
    name: 'real-btcusdt-2024-10-28.csv',
    text: historical,
    hasHeader: false,
    source: {
      kind: 'historical',
      label: provenance.label,
      note: `${provenance.transformation} ${provenance.verificationBoundary}`,
      url: provenance.upstreamUrl,
      expectedSha256: provenance.csvSha256,
    },
  },
  {
    id: 'synthetic-ms',
    name: 'synthetic-ms.csv',
    text: ms,
    hasHeader: true,
    source: {
      kind: 'synthetic',
      label: '人工合成样本 · 毫秒',
      note: 'DEMO/USDT，固定人工构造的 1 分钟 OHLCV；不是真实行情。',
    },
  },
  {
    id: 'synthetic-us',
    name: 'synthetic-us.csv',
    text: us,
    hasHeader: true,
    source: {
      kind: 'synthetic',
      label: '人工合成样本 · 微秒',
      note: '与毫秒合成样本相同的人工值，仅时间戳乘以 1000；不代表原生交易所微秒数据。',
    },
  },
  {
    id: 'errors',
    name: 'error-cases.csv',
    text: errors,
    hasHeader: true,
    source: {
      kind: 'error-fixture',
      label: '错误测试样本 · 人工构造',
      note: '故意包含重复、缺口、价格/量/OHLC/时间和列数错误，不能用于行情研究。',
    },
  },
];
