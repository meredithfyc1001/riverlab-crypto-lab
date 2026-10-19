import { useEffect, useRef, useState } from 'react';
import { fields } from '../../core/data';
import type {
  CandleField,
  ColumnMapping,
  CsvInspection,
  CsvSettings,
  ImportOptions,
  TimeUnit,
} from '../../core/data';
import { samples, userSource } from './samples';
import type { DataSource } from './samples';
import { startCsvJob } from './worker-client';
import { MAX_FILE_BYTES } from './worker-types';
import type {
  CsvJob,
  CsvResult,
  FileIdentity,
  ReportView,
} from './worker-types';
import { QualityReport } from './QualityReport';
import './datasets.css';

const initialSettings: CsvSettings = { delimiter: ',', hasHeader: true };
const emptyMapping: ColumnMapping = {
  timestamp: null,
  open: null,
  high: null,
  low: null,
  close: null,
  volume: null,
};
const labels: Record<CandleField, string> = {
  timestamp: '时间戳列',
  open: '开盘价列',
  high: '最高价列',
  low: '最低价列',
  close: '收盘价列',
  volume: '成交量列',
};
function intervalFromSeconds(value: string): number | null {
  if (!value.trim()) return null;
  if (!/^\d+(?:\.\d{1,3})?$/.test(value)) return NaN;
  const [seconds, fraction = ''] = value.split('.');
  return Number(seconds) * 1000 + Number(fraction.padEnd(3, '0'));
}

export function DatasetCenter() {
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState<DataSource>(userSource);
  const [sourceNote, setSourceNote] = useState('');
  const [settings, setSettings] = useState<CsvSettings>(initialSettings);
  const [inspection, setInspection] = useState<CsvInspection | null>(null);
  const [identity, setIdentity] = useState<FileIdentity | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>(emptyMapping);
  const [timeUnit, setTimeUnit] = useState<TimeUnit>('auto');
  const [seconds, setSeconds] = useState('');
  const [report, setReport] = useState<ReportView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const activeJob = useRef<ReturnType<typeof startCsvJob> | null>(null);
  useEffect(
    () => () => {
      generation.current++;
      activeJob.current?.cancel();
    },
    [],
  );

  async function execute(
    request: CsvJob,
    consume: (result: CsvResult) => void,
  ) {
    const id = ++generation.current;
    activeJob.current?.cancel();
    setBusy(true);
    setError('');
    const job = startCsvJob(request);
    activeJob.current = job;
    try {
      const result = await job.promise;
      if (id === generation.current) {
        setIdentity(result.identity);
        consume(result);
      }
    } catch (failure) {
      if (id === generation.current)
        setError(failure instanceof Error ? failure.message : 'CSV 读取失败。');
    } finally {
      if (id === generation.current) {
        setBusy(false);
        activeJob.current = null;
      }
    }
  }
  function selectFile(
    nextFile: File,
    nextSource: DataSource,
    nextSettings: CsvSettings,
  ) {
    generation.current++;
    activeJob.current?.cancel();
    activeJob.current = null;
    setBusy(false);
    setFile(nextFile);
    setSource(nextSource);
    setSourceNote('');
    setSettings(nextSettings);
    setInspection(null);
    setIdentity(null);
    setReport(null);
    setMapping(emptyMapping);
    setTimeUnit('auto');
    setSeconds('');
    setError('');
    if (nextFile.size > MAX_FILE_BYTES) {
      setError('文件超过 10 MiB，请拆分 CSV 后重试。');
      return;
    }
    void execute(
      {
        file: nextFile,
        settings: nextSettings,
        expectedSha256: nextSource.expectedSha256,
      },
      (result) => {
        if (result.kind === 'inspection') {
          setInspection(result.inspection);
          setMapping(result.inspection.mapping);
        }
      },
    );
  }
  function changeSettings(patch: Partial<CsvSettings>) {
    if (file) selectFile(file, source, { ...settings, ...patch });
    else setSettings({ ...settings, ...patch });
  }
  function cancel() {
    generation.current++;
    activeJob.current?.cancel();
    activeJob.current = null;
    setBusy(false);
    setReport(null);
    setInspection(null);
    setIdentity(null);
    setFile(null);
    setError('已取消；请选择文件或样本重新开始。');
  }
  function analyze() {
    if (!file) return;
    setReport(null);
    const options: ImportOptions = {
      ...settings,
      mapping,
      timeUnit,
      intervalMs: intervalFromSeconds(seconds),
    };
    void execute(
      { file, settings, options, expectedSha256: source.expectedSha256 },
      (result) => {
        if (result.kind === 'report') setReport(result.report);
      },
    );
  }

  return (
    <div className="dataset-center">
      <section className="panel import-setup" aria-labelledby="import-title">
        <div className="section-heading">
          <div>
            <span className="eyebrow">LOCAL DATA / CSV</span>
            <h2 id="import-title">导入历史 K 线 CSV</h2>
          </div>
          <span className="badge">Phase 1A</span>
        </div>
        <p className="muted">
          文件仅在浏览器内处理，不会上传。支持 UTF-8 CSV（含 BOM）、最多 10 MiB
          / 50,000 行 / 64 列；解析在 Worker
          中运行。仅当前数据中心会话保留报告，离开页面或刷新会清除，原 CSV
          不会改写。
        </p>
        <label className="file-picker">
          选择本地 CSV
          <input
            aria-label="选择本地 CSV"
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => {
              const selected = event.target.files?.[0];
              if (selected) selectFile(selected, userSource, settings);
              event.target.value = '';
            }}
          />
        </label>
        <div className="sample-actions" aria-label="内置来源样本">
          {samples.map((sample) => (
            <button
              type="button"
              disabled={busy}
              key={sample.id}
              onClick={() =>
                selectFile(
                  new File([sample.text], sample.name, { type: 'text/csv' }),
                  sample.source,
                  { delimiter: ',', hasHeader: sample.hasHeader },
                )
              }
            >
              {sample.source.label}
            </button>
          ))}
        </div>
        <div role="status" aria-live="polite">
          {busy
            ? '正在本地读取与检查 CSV…'
            : file
              ? `当前文件：${file.name}`
              : '选择 CSV 或载入一个明确标记来源的样本。'}
        </div>
        {busy && (
          <button type="button" className="cancel-import" onClick={cancel}>
            取消处理
          </button>
        )}
        {error && (
          <p className="import-error" role="alert">
            {error}
          </p>
        )}
      </section>

      {file && (
        <section className="panel source-panel" aria-labelledby="source-title">
          <h2 id="source-title">来源与文件身份</h2>
          <p className="source-kind">{source.label}</p>
          <p className="muted">{source.note}</p>
          {source.url && (
            <a
              className="text-link"
              href={source.url}
              target="_blank"
              rel="noreferrer"
            >
              查看固定提交中的来源存档 ↗
            </a>
          )}
          {source.kind === 'user-unverified' && (
            <label>
              来源说明（自述，不认证真实性）
              <input
                type="text"
                maxLength={300}
                value={sourceNote}
                onChange={(event) => setSourceNote(event.target.value)}
                placeholder="例如：提供方、交易对、市场、采集日期"
              />
            </label>
          )}
          {identity && (
            <details>
              <summary>SHA-256 与解析版本</summary>
              <p className="muted">
                {identity.bytes} bytes · {identity.parserVersion} ·
                哈希仅校验文件身份，不认证来源。
              </p>
              <code className="file-hash">{identity.sha256}</code>
            </details>
          )}
        </section>
      )}

      {file && (
        <section
          className="panel mapping-panel"
          aria-labelledby="mapping-title"
        >
          <h2 id="mapping-title">字段映射与时间约定</h2>
          <fieldset disabled={busy}>
            <legend className="sr-only">CSV 格式设置</legend>
            <div className="format-controls">
              <label>
                分隔符
                <select
                  aria-label="分隔符"
                  value={settings.delimiter}
                  onChange={(event) =>
                    changeSettings({
                      delimiter: event.target.value as CsvSettings['delimiter'],
                    })
                  }
                >
                  <option value=",">逗号 (,)</option>
                  <option value=";">分号 (;)</option>
                  <option value={'\t'}>制表符 (Tab)</option>
                </select>
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={settings.hasHeader}
                  onChange={(event) =>
                    changeSettings({ hasHeader: event.target.checked })
                  }
                />
                首条非空记录是表头
              </label>
            </div>
          </fieldset>
          {inspection && (
            <>
              {inspection.truncated && (
                <p className="import-error" role="alert">
                  解析因资源上限停止，结果不完整；请拆分文件后重试。
                </p>
              )}
              <p className="muted">
                读到 {inspection.recordCount}{' '}
                条数据记录。自动建议映射仅为初始值，请对照原始预览确认；未映射的附加列不会参与
                OHLCV 检查。
              </p>
              {inspection.issues.map((issue, index) => (
                <p className="import-warning" key={index}>
                  {issue.line ? `原始行 ${issue.line}：` : ''}
                  {issue.message}
                </p>
              ))}
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  analyze();
                }}
              >
                <fieldset
                  disabled={
                    busy ||
                    inspection.truncated ||
                    inspection.headers.length === 0
                  }
                >
                  <legend className="sr-only">行情字段与时间</legend>
                  <div className="mapping-grid">
                    {fields.map((field) => (
                      <label key={field}>
                        {labels[field]}
                        <select
                          value={mapping[field] ?? ''}
                          onChange={(event) => {
                            setMapping({
                              ...mapping,
                              [field]:
                                event.target.value === ''
                                  ? null
                                  : Number(event.target.value),
                            });
                            setReport(null);
                          }}
                        >
                          <option value="">请选择列</option>
                          {inspection.headers.map((header, index) => (
                            <option key={index} value={index}>
                              {index + 1} · {header || '（空列名）'}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                  <div className="time-controls">
                    <label>
                      时间单位
                      <select
                        value={timeUnit}
                        onChange={(event) => {
                          setTimeUnit(event.target.value as TimeUnit);
                          setReport(null);
                        }}
                      >
                        <option value="auto">
                          自动识别（无法确定会要求确认）
                        </option>
                        <option value="ms">毫秒（明确指定）</option>
                        <option value="us">微秒（明确指定）</option>
                        <option value="iso">ISO 8601（必须带时区）</option>
                      </select>
                    </label>
                    <label>
                      预期固定周期（秒）
                      <input
                        type="number"
                        step="0.001"
                        min="0.001"
                        max="31536000"
                        placeholder="留空则无法判断缺失 K 线"
                        value={seconds}
                        onChange={(event) => {
                          setSeconds(event.target.value);
                          setReport(null);
                        }}
                      />
                    </label>
                  </div>
                  <p className="muted">
                    自动识别依据固定 2009–2100
                    范围，超出或混用单位必须明确指定。微秒必须能精确转换为整毫秒，不舍入。ISO
                    时间必须带 Z 或偏移；不使用浏览器本地时区。
                  </p>
                  <button type="submit" className="analyze-button">
                    检查并生成导入报告
                  </button>
                </fieldset>
              </form>
              <details>
                <summary>原始数据预览（前 5 条，保留物理行号）</summary>
                <div
                  className="table-scroll"
                  role="region"
                  aria-label="原始 CSV 预览"
                  tabIndex={0}
                >
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">原始行</th>
                        {inspection.headers.map((header, index) => (
                          <th scope="col" key={index}>
                            {index + 1} · {header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {inspection.preview.map((row) => (
                        <tr key={row.line}>
                          <th scope="row">{row.line}</th>
                          {row.cells.map((value, index) => (
                            <td key={index}>{value.slice(0, 100)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          )}
        </section>
      )}
      {report && (
        <>
          {report.needsConfirmation.length > 0 && (
            <div className="panel confirmation-panel" role="status">
              <strong>
                需要确认：
                {report.needsConfirmation
                  .map((item) =>
                    item === 'timeUnit' ? '时间单位' : '预期周期',
                  )
                  .join('、')}
              </strong>
              <p>请修改上方约定后重新检查，当前不是已完成的数据集。</p>
              {report.needsConfirmation.includes('interval') &&
                report.suggestedIntervalMs !== null && (
                  <button
                    type="button"
                    onClick={() => {
                      setSeconds(String(report.suggestedIntervalMs! / 1000));
                      setReport(null);
                    }}
                  >
                    采用建议周期 {report.suggestedIntervalMs / 1000}{' '}
                    秒（仍需重新检查）
                  </button>
                )}
            </div>
          )}
          <QualityReport
            key={`${identity?.sha256}-${timeUnit}-${seconds}`}
            report={report}
          />
        </>
      )}
    </div>
  );
}
