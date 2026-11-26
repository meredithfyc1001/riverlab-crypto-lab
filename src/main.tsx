import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './app/styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('应用挂载节点缺失。');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if (
  import.meta.env.MODE === 'desktop-6a' &&
  '__RIVERLAB_6A_NATIVE_VERIFY__' in window &&
  window.__RIVERLAB_6A_NATIVE_VERIFY__ === true &&
  '__TAURI__' in window
) {
  const host = window.__TAURI__;
  void import('../tests/desktop-6a/native-acceptance').then(
    ({ runNativeAcceptance }) =>
      runNativeAcceptance(host as Parameters<typeof runNativeAcceptance>[0]),
  );
}
