import type { SnapshotReceipt } from '../../infrastructure/snapshot-format';
import type {
  SnapshotLayout,
  SnapshotSourceReport,
} from '../../infrastructure/snapshot-source';

export type SnapshotProgress = {
  database: string;
  store: string;
  read: number;
  total: number;
};

export type ExportNotice =
  | { type: 'layout'; layout: SnapshotLayout }
  | { type: 'progress'; progress: SnapshotProgress };

export type FromWorker =
  | ExportNotice
  | { type: 'chunk'; bytes: Uint8Array<ArrayBuffer> }
  | { type: 'complete'; receipt: SnapshotReceipt; report: SnapshotSourceReport }
  | { type: 'failed'; message: string; missingDatabases?: string[] };

export type ToWorker = { type: 'start' } | { type: 'ack' };
