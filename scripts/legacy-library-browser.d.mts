import type { Page } from '@playwright/test';
export function exerciseLegacyLibrary(
  page: Page,
  baseUrl: string,
  fixturePath?: string,
): Promise<{
  damagedRowsPerLibrary: number;
  healthyRowsPerLibrary: number;
  datasetSha256: string;
  ruleHash: string;
  riskHash: string;
  replayHash: string;
  preservedDatabaseSha256: string;
}>;
