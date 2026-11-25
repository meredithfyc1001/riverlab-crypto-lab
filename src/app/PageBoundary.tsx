import { Component } from 'react';
import type { ReactNode } from 'react';

export class PageBoundary extends Component<{ children: ReactNode }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <section className="panel dataset-next-step" role="alert">
          <h2>页面载入失败</h2>
          <p>
            请确认本机服务仍在运行，且解压目录完整。重新载入会清除未保存的操作。
          </p>
          <button type="button" onClick={() => window.location.reload()}>
            重新载入页面
          </button>
        </section>
      );
    return this.props.children;
  }
}
