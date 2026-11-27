import { createRoot } from 'react-dom/client';
import { SnapshotPage } from './features/snapshot';
import './app/styles.css';
import './features/snapshot/snapshot.css';

const root = document.getElementById('root');
if (!root) throw new Error('快照导出挂载节点缺失。');
createRoot(root).render(<SnapshotPage />);
