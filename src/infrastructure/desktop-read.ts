import { restoreSnapshotValue } from './snapshot-restore';

export interface DesktopRead {
  bytes: Uint8Array<ArrayBuffer>;
  structured: boolean;
}
const utf8 = () => new TextDecoder('utf-8', { fatal: true });

// Legacy lists start with a count and one length per item. The negotiated
// format adds a descriptor length directly after each projection length.
function decodeRows(read: DesktopRead, single: boolean): unknown[] {
  const { bytes, structured } = read;
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = utf8();
  let offset = 0;
  function length() {
    if (offset + 4 > bytes.length) throw new Error('桌面记录帧头不完整。');
    const n = header.getUint32(offset, true);
    offset += 4;
    return n;
  }
  function take(n: number) {
    if (offset + n > bytes.length) throw new Error('桌面记录帧长度错误。');
    const field = bytes.subarray(offset, offset + n);
    offset += n;
    return field;
  }
  const count = length(),
    rows: unknown[] = [];
  if (single && count !== 1) throw new Error('读取单条正文时记录数量错误。');
  for (let i = 0; i < count; i++) {
    const p = length(),
      d = structured ? length() : 0;
    const projection = take(p),
      descriptor = take(d);
    try {
      const text = decoder.decode(projection);
      rows.push(
        d
          ? restoreSnapshotValue(text, decoder.decode(descriptor))
          : JSON.parse(text),
      );
    } catch (error) {
      if (single) throw error;
      rows.push(null);
    }
  }
  if (offset !== bytes.length) throw new Error('桌面记录帧含多余数据。');
  return rows;
}
export function decodeDesktopBody(read: DesktopRead): unknown {
  return read.structured
    ? decodeRows(read, true)[0]
    : JSON.parse(utf8().decode(read.bytes));
}
export function decodeDesktopSummaries(read: DesktopRead): unknown[] {
  return decodeRows(read, false);
}
