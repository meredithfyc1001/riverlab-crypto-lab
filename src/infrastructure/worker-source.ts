// A dedicated port binds one source lookup to one task. The window transfers
// ownership of the original UTF-8 bytes; decoding and validation run in the Worker.
import { desktopRepository, isDesktopRepository } from './desktop-repository';

type SourceKind = 'dataset' | 'experiment' | 'portfolio' | 'shared_pool';
type Reply = { bytes: Uint8Array<ArrayBuffer> } | { error: string };

export function openWorkerSource(kind: SourceKind) {
  if (!isDesktopRepository()) return;
  const { port1, port2 } = new MessageChannel();
  const controller = new AbortController();
  port1.onmessage = async ({ data: id }) => {
    port1.onmessage = null;
    try {
      if (typeof id !== 'string' || !id || id.length > 100)
        throw new Error('研究来源 ID 无效。');
      const bytes = await desktopRepository.getBytes(
        kind,
        id,
        controller.signal,
      );
      if (!bytes) throw new Error('找不到所选来源，请重新检查研究库。');
      if (!controller.signal.aborted)
        port1.postMessage({ bytes } satisfies Reply, [bytes.buffer]);
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
        resolve(
          JSON.parse(
            new TextDecoder('utf-8', { fatal: true }).decode(data.bytes),
          ),
        );
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
