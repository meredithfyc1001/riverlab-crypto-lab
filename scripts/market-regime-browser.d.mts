import type { Page } from '@playwright/test';
export function exerciseMarketRegime(
  page: Page,
  freshPage: () => Promise<Page>,
  options: {
    kind: 'single' | 'portfolio' | 'shared';
    source: string;
    reference: string | null;
    expectedNetPnl?: string;
  },
): Promise<string>;
