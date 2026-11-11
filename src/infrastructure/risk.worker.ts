import { verifyExperiment } from '../core/experiments';
import {
  analyzeExperiment,
  sourcePreview,
  sealRiskStudy,
  verifyRiskStudy,
  riskCsv,
  assertRiskStudy,
} from '../core/risk-analysis';
import { ExperimentStore } from './experiment-store';
import type { RiskRequest, RiskResponse } from './risk-worker';
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<RiskRequest>) => void) | null;
  postMessage: (r: RiskResponse) => void;
};
function historical(end: number, now: number) {
  if (
    !Number.isSafeInteger(now) ||
    now < 0 ||
    now > 4_102_444_800_000 ||
    !Number.isSafeInteger(end) ||
    end > now
  )
    throw new Error('源完成声明晚于当前时间或无效，阻止分析。');
}
scope.onmessage = async ({ data: r }) => {
  const start = performance.now();
  const progress = (completed: number, total: number) =>
    scope.postMessage({ kind: 'progress', completed, total });
  try {
    if (r.kind === 'inspect' || r.kind === 'run') {
      const value = await new ExperimentStore().load(r.sourceId);
      if (r.kind === 'inspect') {
        const e = verifyExperiment(value);
        historical(
          e.payload.result.manifest.completedThroughUtcMs,
          r.observedUtcMs,
        );
        scope.postMessage({ kind: 'success', preview: sourcePreview(e) });
      } else {
        const e = value as Parameters<typeof sourcePreview>[0];
        historical(
          e?.payload?.result?.manifest?.completedThroughUtcMs,
          r.observedUtcMs,
        );
        if (e?.payloadHash !== r.expectedHash)
          throw new Error('源实验已改变，请重新检查来源。');
        const payload = analyzeExperiment(value, r.settings, progress);
        const record = sealRiskStudy(payload, {
          id: r.id,
          name: r.name,
          createdUtcMs: r.createdUtcMs,
          elapsedMs: performance.now() - start,
        });
        scope.postMessage({ kind: 'success', record });
      }
    } else {
      assertRiskStudy(r.record);
      historical(
        r.record.payload.source.input.completedThroughUtcMs,
        r.observedUtcMs,
      );
      const record = verifyRiskStudy(r.record, progress);
      scope.postMessage({
        kind: 'success',
        record,
        ...(r.kind === 'export'
          ? {
              text:
                r.format === 'json'
                  ? JSON.stringify(record, null, 2)
                  : riskCsv(record),
            }
          : {}),
      });
    }
  } catch (e) {
    scope.postMessage({
      kind: 'error',
      message: e instanceof Error ? e.message : '风险分析失败；未自动修复。',
    });
  }
};
