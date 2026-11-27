// A dedicated port binds one source lookup to one task. The window transfers
// ownership of the original UTF-8 bytes; decoding and validation run in the Worker.
import { desktopRepository, isDesktopRepository } from './desktop-repository';

import { decodeDesktopBody, type DesktopRead } from './desktop-read';

type SourceKind = 'dataset' | 'experiment' | 'portfolio' | 'shared_pool';
type Reply = DesktopRead | { error: string };

export function openWorkerSource(kind: SourceKind) {
  if (!isDesktopRepository()) return;
  const { port1, port2 } = new MessageChannel();
  const controller = new AbortController();
  port1.onmessage = async ({ data: id }) => {
    port1.onmessage = null;
    try {
      if (typeof id !== 'string' || !id || id.length > 100)
        throw new Error('研究来源 ID 无效。');
      const result = await desktopRepository.getDomainBytes(
        kind,
        id,
        controller.signal,
      );
      if (!result) throw new Error('找不到所选来源，请重新检查研究库。');
      if (!controller.signal.aborted)
        port1.postMessage(result satisfies Reply, [result.bytes.buffer]);
    } catch (e) {
      if (!controller.signal.aborted)
        port1.postMessage({
          error: e instanceof Error ? e.message : '桌面研究来源读取失败。',
        } satisfies Reply);
    } finally {
      port1.close();
    }
  };
  return {
    port: port2,
    close() {
      controller.abort();
      port1.close();
      port2.close();
    },
  };
}

export function readWorkerSource(
  port: MessagePort,
  id: string,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    port.onmessage = ({ data }: MessageEvent<Reply>) => {
      port.close();
      try {
        if ('error' in data) throw new Error(data.error);
        resolve(decodeDesktopBody(data));
      } catch (error) {
        reject(error);
      }
    };
    port.onmessageerror = () => {
      port.close();
      reject(new Error('无法接收桌面研究来源。'));
    };
    port.postMessage(id);
  });
}
