import type { Page } from '@playwright/test';

type Mode = 'shared-strategy' | 'rebalance';
export function selectSharedAssets(
  page: Page,
  mode: Mode,
  symbols: readonly string[],
): Promise<void>;
export function exerciseSharedModes(
  page: Page,
  freshPage: () => Promise<Page>,
  symbols: readonly string[],
): Promise<Record<Mode, string>>;
