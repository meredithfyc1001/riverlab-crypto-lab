import type { Page } from '@playwright/test';
import type { AdvancedReport } from '../src/core/advanced-research/report';
export function prepareAdvancedResearch(
  page: Page,
  baseUrl: string,
  fixturesDir?: string,
): Promise<void>;
export function runAdvancedResearch(page: Page): Promise<AdvancedReport>;
export function exerciseAdvancedResearch(
  page: Page,
  baseUrl: string,
  fixturesDir?: string,
): Promise<{
  reportHash: string;
  selectedLookbacks: number[];
  testReturns: string[];
}>;
