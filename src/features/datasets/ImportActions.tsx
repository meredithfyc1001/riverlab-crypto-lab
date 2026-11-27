import { isDesktopRepository } from '../../infrastructure/desktop-repository';
import { useState } from 'react';
import type { ReportView } from './worker-types';

export function ImportActions({
  report,
  disabled,
  saved,
  onPrepare,
}: {
  report: ReportView;
  disabled: boolean;
  saved: boolean;
  onPrepare: (symbol: string, save: boolean) => void;
}) {
  const [ack, setAck] = useState(false);
  const [symbol, setSymbol] = useState('');
  const eligible =
    report.status === 'reviewed' && !report.errorCount && report.validRows > 0;
  return (
    <section className="panel import-setup" aria-label="使用已检查数据">
      <h2>使用已检查数据</h2>
      <p>
        有错误或待确认项时不截取有效子集，不允许用于图表或保存。通过检查的数据将完整保留{' '}
        {report.validRows} 根 K 线，另行保留原 CSV 文件。
      </p>
      {!eligible && (
        <p className="import-error">
          当前数据尚不可用，请修正原文件或确认约定后重新检查。
        </p>
      )}
      <label>
        币种 / 交易对（自述，不认证来源）
        <input
          maxLength={80}
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          placeholder="例如 BTC/USDT 或 DEMO/USDT"
        />
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={ack}
          onChange={(e) => setAck(e.target.checked)}
        />
        我已阅读 {report.warningCount}{' '}
        项警告：仅文件内检查，首尾完整性及来源未获证明；缺口不填补，指标在缺口后重新预热。
      </label>
      <div className="sample-actions">
        <button
          disabled={disabled || !eligible || !ack || !symbol.trim()}
          onClick={() => onPrepare(symbol.trim(), false)}
        >
          用于行情中心
        </button>
        <button
          disabled={disabled || !eligible || !ack || !symbol.trim()}
          onClick={() => onPrepare(symbol.trim(), true)}
        >
          保存已检查数据集
        </button>
      </div>
      {saved && (
        <a className="primary-link" href="#/backtests">
          前往回测中心选择已保存数据集
        </a>
      )}
      <p className="muted">
        {isDesktopRepository()
          ? '保存后可从桌面数据集列表重开。重要数据请另外导出备份。'
          : '浏览器本地存储可能被清理、拒绝或因隐私模式丢失，不是永久可靠存储；请另外导出备份。'}
      </p>
    </section>
  );
}
