import assert from 'node:assert/strict';

// Each workflow creates a new run context then restores only its exported file
// in a second, empty context. Keeping the first page alive retains its download.
export async function sampleShared(browser, page, url, assetCount, mode) {
  await page.waitForFunction(
    () => typeof globalThis.runSharedSample === 'function',
  );
  const [sample, downloaded] = await Promise.all([
    page.evaluate(
      ([n, m]) => globalThis.runSharedSample(n, m),
      [assetCount, mode],
    ),
    page.waitForEvent('download', { timeout: 120000 }),
  ]);
  assert.equal(await downloaded.failure(), null);
  const clean = await browser.newPage();
  try {
    await clean.goto(url);
    await clean.getByLabel('恢复报告').setInputFiles(await downloaded.path());
    const restored = await clean.evaluate(() =>
      globalThis.restoreSharedSample(),
    );
    assert.equal(sample.payloadHash, restored.payloadHash);
    assert.equal(sample.recordHash, restored.recordHash);
    assert.equal(sample.fills, restored.restoredFills);
    assert.ok(sample.ticks > 1 && restored.ticks > 1);
    assert.equal(sample.bars, 10000 / assetCount);
    if (mode === 'shared-strategy') {
      assert.ok(sample.simultaneousBuys >= 100);
    } else {
      assert.equal(sample.rebalances, sample.bars - 1);
      assert.ok(sample.partialSales >= 100);
    }
    return {
      ...sample,
      sameHash: true,
      restoreMs: restored.restoreMs,
      maxMainHeapBytes: Math.max(
        sample.maxMainHeapBytes,
        restored.maxMainHeapBytes,
      ),
      maxMainTimerGapMs: Math.max(
        sample.maxMainTimerGapMs,
        restored.maxMainTimerGapMs,
      ),
      ticks: sample.ticks + restored.ticks,
    };
  } finally {
    await clean.close();
  }
}
