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
  const [activeId, setActiveId] = useState(() =>
    pageFromHash(window.location.hash),
  );
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const activePage = pages.find((page) => page.id === activeId) ?? pages[0];

  useEffect(() => {
    const onHashChange = () => setActiveId(pageFromHash(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

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
          <small>v0.1.0 / Phase 1B 数据基础</small>
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
            <span className="badge">Phase 1B · 图表与存储</span>
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
                    图表与存储 <small>Phase 1B</small>
                  </strong>
                  <p>历史图表、基础指标与本地数据集</p>
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
                    尚未启用 <small>后续阶段</small>
                  </strong>
                  <p>当前未运行策略或生成回测结果</p>
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
                          {page.id === 'datasets' ? 'CSV 导入可用' : '待开发'}
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
