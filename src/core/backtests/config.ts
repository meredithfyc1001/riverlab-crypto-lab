import { decimal, parseDecimal } from './decimal';
import type { BacktestConfig } from './types';

export const DEFAULT_CONFIG: Readonly<BacktestConfig> = Object.freeze({
  initialCash: '1000',
  feeBps: 10,
  buySlippageBps: 10,
  sellSlippageBps: 10,
  quantityDecimals: 8,
  minNotional: '0',
});
export function normalizeConfig(
  input: Partial<BacktestConfig> = {},
): BacktestConfig {
  if (
    !input ||
    typeof input !== 'object' ||
    Object.getPrototypeOf(input) !== Object.prototype ||
    Array.isArray(input) ||
    Object.keys(input).some((k) => !Object.hasOwn(DEFAULT_CONFIG, k))
  )
    throw new Error('Unknown or invalid backtest configuration.');
  const config = { ...DEFAULT_CONFIG, ...input };
  for (const n of [
    config.feeBps,
    config.buySlippageBps,
    config.sellSlippageBps,
  ])
    if (!Number.isInteger(n) || n < 0 || n >= 10000)
      throw new Error('Basis points must be integers in 0..9999.');
  if (
    !Number.isInteger(config.quantityDecimals) ||
    config.quantityDecimals < 0 ||
    config.quantityDecimals > 18
  )
    throw new Error('Quantity precision must be an integer in 0..18.');
  config.initialCash = decimal(parseDecimal(config.initialCash));
  config.minNotional = decimal(parseDecimal(config.minNotional));
  return config;
}
