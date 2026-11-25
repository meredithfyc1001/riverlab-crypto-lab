import { useState } from 'react';
import { DEFAULT_REGIME_PARAMS } from '../../core/market-regime/model';
import type { RegimeSourceKind } from '../../infrastructure/market-regime-worker';
import type { SummaryList } from '../../infrastructure/summary-list';
import { RegimeResults } from './RegimeResults';
import { type Theme, utc } from './presentation';
import { useRegimeWorkbench } from './useRegimeWorkbench';
import './market-regime.css';

const sourceLabels = {
  single: '单币种实验库',
  portfolio: '固定子账户',
  shared: '共享资金池',
} as const;

function LibraryNotice({
  label,
  list,
}: {
  label: string;
  list: SummaryList<unknown> | { error: string };
}) {
  if ('error' in list)
    return (
      <p role="alert">
        {label}读取失败。{list.error}
      </p>
    );
  if (list.damagedCount)
    return (
      <p role="alert">
        {label}：可用摘要 {list.items.length} 条，已隔离 {list.damagedCount}{' '}
        条损坏摘要。正文将在使用时校验并重算。
      </p>
    );
  return null;
}

export default function MarketRegimeCenter({ theme }: { theme: Theme }) {
  const w = useRegimeWorkbench();
  const [kind, setKind] = useState<RegimeSourceKind>('single');
  const [sourceId, setSourceId] = useState('');
  const [reference, setReference] = useState('');
  const [lookback, setLookback] = useState(
    String(DEFAULT_REGIME_PARAMS.lookback),
  );
  const [threshold, setThreshold] = useState(
    String(DEFAULT_REGIME_PARAMS.thresholdBps),
  );
  const [name, setName] = useState('市场状态研究');
  const [confirmDelete, setConfirmDelete] = useState('');
  const { sources } = w;
  const selectedLibrary = sources?.[kind];
  const available =
    selectedLibrary && 'items' in selectedLibrary ? selectedLibrary.items : [];
  const reportList = w.records && 'items' in w.records ? w.records : null;
  const source = available.find((s) => s.id === sourceId);
  const valid =
    source &&
    (kind === 'single' || source.symbols.includes(reference)) &&
    name.trim() &&
    /^\d+$/.test(lookback) &&
    +lookback >= 1 &&
    +lookback <= 50000 &&
    /^\d+$/.test(threshold) &&
    +threshold >= 1 &&
    +threshold <= 10000;
  return (
    <div className="regime-workbench">
      <section className="panel">
        <h2>选择实验与观察参数</h2>
        <p className="regime-notice">
          市场状态是模型根据已收盘历史数据给出的标签。这些标签不能确定客观市场周期，也不能预测未来。
        </p>
        {sources ? (
          (Object.keys(sourceLabels) as RegimeSourceKind[]).map((key) => (
            <LibraryNotice
              key={key}
              label={sourceLabels[key]}
              list={sources[key]}
            />
          ))
        ) : (
          <p>正在读取来源实验摘要…</p>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (valid && source)
              w.run(
                source,
                kind === 'single' ? null : reference,
                { lookback: Number(lookback), thresholdBps: Number(threshold) },
                name.trim(),
              );
          }}
        >
          <fieldset disabled={w.busy} className="regime-form">
            <label>
              原实验类型
              <select
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value as RegimeSourceKind);
                  setSourceId('');
                  setReference('');
                }}
              >
                <option value="single">单币种回测</option>
                <option value="portfolio">固定子账户组合</option>
                <option value="shared">共享资金池与定期再平衡组合</option>
              </select>
            </label>
            <label>
              已保存的原实验
              <select
                value={sourceId}
                onChange={(e) => {
                  setSourceId(e.target.value);
                  setReference('');
                }}
              >
                <option value="">请选择实验</option>
                {available.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name} · {row.symbols.join(' / ')} ·{' '}
                    {row.payloadHash.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
            {kind !== 'single' && (
              <label>
                组合参考资产
                <select
                  value={reference}
                  disabled={!source}
                  onChange={(e) => setReference(e.target.value)}
                >
                  <option value="">请选择共同时间轴上的资产</option>
                  {source?.symbols.map((symbol) => (
                    <option key={symbol} value={symbol}>
                      {symbol}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              观察周期（根）
              <input
                value={lookback}
                inputMode="numeric"
                pattern="[0-9]+"
                onChange={(e) => setLookback(e.target.value)}
                required
              />
            </label>
            <label>
              趋势阈值（基点）
              <input
                value={threshold}
                inputMode="numeric"
                pattern="[0-9]+"
                onChange={(e) => setThreshold(e.target.value)}
                required
              />
            </label>
            <label>
              报告名称
              <input
                maxLength={160}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </label>
          </fieldset>
          {selectedLibrary &&
            'items' in selectedLibrary &&
            selectedLibrary.damagedCount === 0 &&
            !available.length && (
              <p>
                当前类别尚无可选实验。
                {kind === 'single' ? (
                  <a className="text-link" href="#/experiments">
                    前往实验中心导入并保存实验
                  </a>
                ) : (
                  <a className="text-link" href="#/portfolio">
                    前往组合回测保存实验
                  </a>
                )}
                ，或在下方导入已有市场状态报告。
              </p>
            )}
          <p>
            可选 1–50,000 根和 1–10,000 个整数基点（100 基点 =
            1%）。参数在运行时锁定，组合从共同区间首根开始观察。
          </p>
          <button className="regime-run" disabled={!valid || w.busy}>
            运行市场状态研究
          </button>
        </form>
      </section>
      {w.message && <p role="status">{w.message}</p>}
      {w.error && <p role="alert">{w.error}</p>}
      {w.cancellable && (
        <button className="regime-cancel" onClick={w.cancel}>
          取消市场状态任务
        </button>
      )}
      {w.report && (
        <>
          <RegimeResults
            key={w.report.reportHash}
            report={w.report}
            theme={theme}
          />
          <div className="regime-actions" aria-label="当前报告操作">
            <button disabled={w.busy || w.saved || !w.records} onClick={w.save}>
              保存市场状态报告
            </button>
            <button disabled={w.busy} onClick={() => w.download('json')}>
              导出市场状态 JSON
            </button>
            <button disabled={w.busy} onClick={() => w.download('csv')}>
              导出市场状态 CSV
            </button>
          </div>
        </>
      )}
      <section className="panel">
        <h2>市场状态报告库</h2>
        <label className="regime-import">
          导入市场状态 JSON
          <input
            type="file"
            accept=".json,application/json"
            disabled={w.busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) w.restore(f);
            }}
          />
        </label>
        <p>
          完整 JSON 可在空白浏览器配置中独立重算；导入预览后点击保存写入本机。
        </p>
        {w.records ? (
          <LibraryNotice label="市场状态报告库" list={w.records} />
        ) : (
          <p>正在读取市场状态报告摘要…</p>
        )}
        {reportList && !reportList.items.length && !reportList.damagedCount && (
          <p>尚无已保存的市场状态报告。</p>
        )}
        {reportList && reportList.items.length > 0 && (
          <ul className="regime-records">
            {reportList.items.map((row) => (
              <li key={row.id}>
                <div>
                  <strong>{row.name}</strong>
                  <small>
                    {utc(row.createdUtcMs)} · {row.reportHash.slice(0, 12)}
                  </small>
                </div>
                <div className="regime-actions">
                  <button
                    disabled={w.busy}
                    onClick={() => {
                      setConfirmDelete('');
                      w.open(row);
                    }}
                  >
                    重开
                  </button>
                  {confirmDelete === row.id ? (
                    <>
                      <span>删除「{row.name}」？</span>
                      <button
                        disabled={w.busy}
                        onClick={() => {
                          setConfirmDelete('');
                          w.remove(row.id);
                        }}
                      >
                        确认删除
                      </button>
                      <button onClick={() => setConfirmDelete('')}>
                        取消删除
                      </button>
                    </>
                  ) : (
                    <button
                      disabled={w.busy}
                      onClick={() => setConfirmDelete(row.id)}
                    >
                      删除
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
