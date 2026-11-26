/* In a disposable browser profile running the extracted ZIP, execute this file
 * as a DevTools Snippet. Then call await riverlabAcceptanceFixtures('5E') or
 * ('5D') in the Console. Evaluating the snippet alone performs no writes. */
globalThis.riverlabAcceptanceFixtures = async function (phase) {
  if (!['localhost', '127.0.0.1'].includes(globalThis.location.hostname))
    throw new Error('请在本机 RiverLab 回环地址的临时验收配置运行。');
  const suites = {
    '5D': [
      ['riverlab-crypto-lab-shared-pool', 'experiments', false],
      ['riverlab-crypto-lab-market-regime', 'reports', true],
    ],
    '5E': [
      ['riverlab-crypto-lab', 'datasets', true],
      ['riverlab-crypto-lab-rules', 'versions', false],
      ['riverlab-crypto-lab-replays', 'replays', true],
      ['riverlab-crypto-lab-risk', 'studies', true],
    ],
  };
  const libraries = suites[phase];
  if (!libraries) throw new Error("请选择 '5D' 或 '5E'。");
  const prefix = 'riverlab-acceptance-fixture-v1-';
  const results = [];
  for (const [database, bodyTable, addBadBody] of libraries) {
    let db;
    try {
      db = await new Promise((resolve, reject) => {
        const req = globalThis.indexedDB.open(database, 1);
        req.onupgradeneeded = () => req.transaction.abort();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const rules = bodyTable === 'versions';
      const indexTable = rules ? bodyTable : 'summaries';
      const badIndexId = prefix + (rules ? 'rule@1' : 'summary');
      const badBodyId = prefix + 'body';
      const result = await new Promise((resolve, reject) => {
        const tx = db.transaction(
          rules ? [bodyTable] : [bodyTable, indexTable],
          'readwrite',
        );
        const index = tx.objectStore(indexTable);
        const bodies = tx.objectStore(bodyTable);
        let note = '已追加',
          sourceId;
        const existing = index.getKey(badIndexId);
        existing.onsuccess = () => {
          if (existing.result !== undefined) {
            note = '专用键已存在，本次跳过';
            return;
          }
          const read = index.openCursor();
          read.onsuccess = () => {
            const cursor = read.result;
            if (!cursor) {
              note = '请先在界面保存一条健康记录';
              return;
            }
            if (
              typeof cursor.key !== 'string' ||
              cursor.key.startsWith(prefix)
            ) {
              cursor.continue();
              return;
            }
            sourceId = cursor.key;
            const metadata = cursor.value;
            if (rules) {
              bodies.add({
                ...metadata,
                id: badIndexId,
                familyId: prefix + 'rule',
                recordHash: 'bad',
              });
              return;
            }
            const body = bodies.get(sourceId);
            body.onsuccess = () => {
              if (!body.result) {
                note = '源正文缺失，请在临时配置准备健康记录';
                return;
              }
              // IndexedDB add() aborts on any collision. Source keys never appear in any write.
              bodies.add({ ...body.result, id: badIndexId });
              index.add({ ...metadata, id: badIndexId, name: null });
              if (addBadBody) {
                const name = '联合验收 · 正文损坏';
                bodies.add({
                  ...body.result,
                  id: badBodyId,
                  name,
                  ...(bodyTable === 'reports'
                    ? { params: { ...body.result.params, thresholdBps: 0 } }
                    : { schemaVersion: 0 }),
                });
                index.add({ ...metadata, id: badBodyId, name });
              }
            };
          };
        };
        tx.oncomplete = () =>
          resolve({
            database,
            note,
            sourceId,
            badIndexId,
            badBodyId: addBadBody ? badBodyId : null,
          });
        tx.onabort = () => reject(tx.error ?? new Error('本库写入事务中止'));
      });
      results.push(result);
    } catch (error) {
      results.push({
        database,
        error: String(error),
        note: '请核对应用地址、临时配置与原记录，随后重试。',
      });
    } finally {
      db?.close();
    }
  }
  return results;
};
