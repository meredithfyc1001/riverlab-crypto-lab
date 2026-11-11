import { useRiskWorkbench } from './useRiskWorkbench';
import { RiskCenter } from '../features/risk';
import { useReplayWorkbench } from './useReplayWorkbench';
import { ReplayCenter } from '../features/replay';
import { useResearchWorkbench } from './useResearchWorkbench';
import { ResearchCenter, ResearchResults } from '../features/strategies';
import { useBacktestWorkbench } from './useBacktestWorkbench';
import { BacktestCenter, BacktestResults } from '../features/backtests';
import { ExperimentCenter } from '../features/experiments';
import { useEffect, useState } from 'react';
import { pages, pageFromHash } from './navigation';
import { syntheticExample } from './synthetic-example';
import { SyntheticPreview } from '../components/SyntheticPreview';
import { RiskNotice } from '../components/RiskNotice';
import { ChartCenter } from '../features/charts';
import { useDatasetLibrary } from './useDatasetLibrary';
import { DatasetLibrary } from '../features/datasets';
import { DatasetCenter } from '../features/datasets';

export function App() {
  const library = useDatasetLibrary();
  const backtest = useBacktestWorkbench();
  const research = useResearchWorkbench();
  const replay = useReplayWorkbench();
  const riskStudy = useRiskWorkbench();
  const pauseReplay = replay.pause;
  const [activeId, setActiveId] = useState(() =>
    pageFromHash(window.location.hash),
  );
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const activePage = pages.find((page) => page.id === activeId) ?? pages[0];

  useEffect(() => {
    const onHashChange = () => {
      setActiveId(pageFromHash(window.location.hash));
      pauseReplay();
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [pauseReplay]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('main-content')?.focus();
        }}
      >
        跳至主要内容
      </a>
      <aside className="sidebar">
        <a
          className="brand"
          href="#/overview"
          aria-label="RiverLab Crypto Lab 工作台"
        >
          <span className="brand-symbol" aria-hidden="true">
            R<span>↗</span>
          </span>
          <span>
            <strong>RiverLab</strong>
            <small>CRYPTO LAB</small>
          </span>
        </a>
        <div className="sidebar-caption">研究空间</div>
        <nav aria-label="主要导航">
          {pages.map((page) => (
            <a
              key={page.id}
              className="nav-item"
              href={`#/${page.id}`}
              aria-current={activeId === page.id ? 'page' : undefined}
            >
              <span className="nav-code" aria-hidden="true">
                {page.code}
              </span>
              <span>{page.label}</span>
              {activeId === page.id && (
                <span className="nav-dot" aria-hidden="true" />
              )}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="status-dot" /> 离线优先 · 本地研究
          <small>v0.5.0-test / Phase 5A 风险分析</small>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <span className="breadcrumb">
            研究空间 <span>/</span> <strong>{activePage.label}</strong>
          </span>
          <div className="topbar-actions">
            <span className="local-status">
              <span className="status-dot" /> 仅研究与模拟
            </span>
            <button
              type="button"
              className="theme-button"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              aria-label={`切换为${theme === 'dark' ? '浅色' : '深色'}主题`}
            >
              <span aria-hidden="true">{theme === 'dark' ? '☼' : '☾'}</span>
              <span>{theme === 'dark' ? '浅色' : '深色'}</span>
            </button>
          </div>
        </header>

        <main id="main-content" tabIndex={-1}>
          <div className="page-heading">
            <div>
              <p className="eyebrow">RIVERLAB / RESEARCH WORKSPACE</p>
              <h1>{activePage.label}</h1>
              <p className="page-description">{activePage.description}</p>
            </div>
            <span className="badge">Phase 5A · 风险分析</span>
          </div>

          {activeId === 'overview' ? (
            <>
              <section
                className="welcome-panel"
                aria-labelledby="welcome-title"
              >
                <div>
                  <span className="eyebrow">START WITH A QUESTION</span>
                  <h2 id="welcome-title">先提出假设，再寻找证据。</h2>
                  <p>
                    为历史数据分析、策略验证与风险研究建立一个可复现的工作空间。
                  </p>
                  <a className="primary-link" href="#/datasets">
                    查看数据中心 <span aria-hidden="true">↗</span>
                  </a>
                </div>
                <div className="welcome-art" aria-hidden="true">
                  <div className="orbit orbit-one" />
                  <div className="orbit orbit-two" />
                  <span>
                    R<span>LAB</span>
                  </span>
                  <small>OBSERVE · TEST · LEARN</small>
                </div>
              </section>
              <div className="status-grid">
                <section className="stat-card">
                  <span>项目阶段</span>
                  <strong>
                    风险分析 <small>Phase 5A</small>
                  </strong>
                  <p>固定种子重采样、风险分位与独立报告</p>
                </section>
                <section className="stat-card">
                  <span>研究数据</span>
                  <strong>
                    人工合成 <small>只读示例</small>
                  </strong>
                  <p>前往数据中心导入历史 CSV 并核对来源</p>
                </section>
                <section className="stat-card">
                  <span>实验记录</span>
                  <strong>
                    {backtest.experiments.length} 个 <small>本地保存</small>
                  </strong>
                  <p>前往回测中心运行，实验中心保存与重开</p>
                </section>
              </div>
              <section className="research-path" aria-labelledby="path-title">
                <div className="section-heading">
                  <h2 id="path-title">研究路径</h2>
                  <span className="muted">逐步建立可信的研究过程</span>
                </div>
                <div className="path-grid">
                  {pages
                    .filter((page) =>
                      ['datasets', 'strategies', 'backtests', 'risk'].includes(
                        page.id,
                      ),
                    )
                    .map((page, index) => (
                      <a
                        className="path-card"
                        href={`#/${page.id}`}
                        key={page.id}
                      >
                        <span className="path-number">0{index + 1}</span>
                        <strong>
                          {page.label}
                          <span aria-hidden="true">↗</span>
                        </strong>
                        <p>{page.description}</p>
                        <small>
                          {page.phase} ·{' '}
                          {page.id === 'datasets'
                            ? 'CSV 导入可用'
                            : page.id === 'backtests'
                              ? '回测工作台可用'
                              : page.id === 'strategies'
                                ? '策略研究可用'
                                : '待开发'}
                        </small>
                      </a>
                    ))}
                </div>
              </section>
              <SyntheticPreview dataset={syntheticExample} />
            </>
          ) : activeId === 'datasets' ? (
            <>
              <DatasetLibrary {...library} />
              <DatasetCenter onPrepared={library.prepared} />
            </>
          ) : activeId === 'charts' ? (
            <>
              <DatasetLibrary {...library} />
              <ChartCenter
                key={library.dataset?.id ?? 'empty'}
                dataset={library.dataset}
                theme={theme}
              />
            </>
          ) : activeId === 'risk' ? (
            <>
              <RiskCenter
                experiments={backtest.experiments}
                preview={riskStudy.preview}
                record={riskStudy.record}
                records={riskStudy.records}
                busy={riskStudy.busy}
                saved={riskStudy.saved}
                onSelect={riskStudy.select}
                onRun={riskStudy.run}
                onSave={riskStudy.save}
                onOpen={riskStudy.open}
                onDelete={riskStudy.remove}
                onRestore={riskStudy.restore}
                onExport={riskStudy.exportRecord}
              />
              {riskStudy.message && <p role="status">{riskStudy.message}</p>}
              {riskStudy.error && <p role="alert">{riskStudy.error}</p>}
              {riskStudy.canCancel && (
                <button onClick={riskStudy.cancel}>取消风险任务</button>
              )}
            </>
          ) : activeId === 'replay' ? (
            <>
              <ReplayCenter
                datasets={library.datasets}
                model={replay.model}
                records={replay.records}
                busy={replay.busy}
                playing={replay.playing}
                speed={replay.speed}
                saved={replay.saved}
                theme={theme}
                onSpeed={replay.setSpeed}
                onStart={replay.start}
                onAdvance={replay.advance}
                onToggle={replay.toggle}
                onPause={replay.pause}
                onTrade={replay.trade}
                onNote={replay.note}
                onCheckpoint={replay.checkpoint}
                onCsv={replay.csv}
                onOpen={replay.openSaved}
                onRestore={replay.restore}
                onDelete={replay.remove}
                onEnd={replay.end}
              />
              {replay.message && <p role="status">{replay.message}</p>}
              {replay.error && <p role="alert">{replay.error}</p>}
            </>
          ) : activeId === 'strategies' ? (
            <>
              <ResearchCenter
                datasets={library.datasets}
                dataset={backtest.dataset}
                busy={research.busy || backtest.busy}
                onSelect={backtest.selectDataset}
                onRun={research.run}
                onRestore={research.restore}
              />
              {backtest.error && <p role="alert">{backtest.error}</p>}
              {research.message && <p role="status">{research.message}</p>}
              {research.error && <p role="alert">{research.error}</p>}
              {research.busy && (
                <button onClick={research.cancel}>取消策略研究</button>
              )}
              {research.report && (
                <ResearchResults
                  key={research.report.payloadHash}
                  report={research.report}
                  onExport={research.exportReport}
                />
              )}
            </>
          ) : activeId === 'backtests' || activeId === 'experiments' ? (
            <>
              {activeId === 'backtests' ? (
                <BacktestCenter
                  datasets={library.datasets}
                  dataset={backtest.dataset}
                  busy={backtest.busy}
                  onSelect={backtest.selectDataset}
                  onRun={backtest.run}
                />
              ) : (
                <ExperimentCenter
                  experiments={backtest.experiments}
                  busy={backtest.busy}
                  onOpen={backtest.open}
                  onDelete={backtest.remove}
                />
              )}
              {library.error && <p role="alert">{library.error}</p>}
              {backtest.message && <p role="status">{backtest.message}</p>}
              {backtest.error && (
                <p role="alert" className="import-error">
                  {backtest.error}
                </p>
              )}
              {backtest.canCancel && (
                <button onClick={backtest.cancel}>取消当前任务</button>
              )}
              {backtest.record && (
                <BacktestResults
                  key={backtest.record.id}
                  record={backtest.record}
                  theme={theme}
                  busy={backtest.busy}
                  saved={backtest.saved}
                  onSave={backtest.save}
                  onExport={backtest.exportRecord}
                  onReproduce={backtest.reproduce}
                />
              )}
            </>
          ) : (
            <>
              <section
                className="panel placeholder"
                aria-labelledby="placeholder-title"
              >
                <span className="placeholder-icon" aria-hidden="true">
                  {activePage.code}
                </span>
                <span className="badge badge-amber">
                  {activePage.phase} · 待开发
                </span>
                <h2 id="placeholder-title">{activePage.label}框架已就绪</h2>
                <p>{activePage.scope}</p>
                <p className="muted">
                  当前仅提供页面入口与模块边界，业务功能尚未启用。
                </p>
                <a className="text-link" href="#/overview">
                  返回工作台 <span aria-hidden="true">→</span>
                </a>
              </section>
            </>
          )}
          <RiskNotice />
          <div className="workspace-footnote">
            <span>RiverLab Crypto Lab</span>
            <span>保持好奇，也保持审慎。</span>
          </div>
        </main>
      </div>
    </div>
  );
}
