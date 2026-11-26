import { describe, expect, it } from 'vitest';
import { chartColors } from '../../src/shared/chart-colors';
import { colors as regimes } from '../../src/features/market-regime/presentation';

function rgb(hex: string) {
  return hex
    .slice(1)
    .match(/../g)!
    .map((component) => parseInt(component, 16));
}

function over(foreground: number[], backdrop: number[], opacity: number) {
  return foreground.map((channel, i) =>
    Math.round(channel * opacity + backdrop[i] * (1 - opacity)),
  );
}

function contrast(first: number[], second: number[]) {
  const luminance = (channels: number[]) => {
    const [r, g, b] = channels.map((channel) => {
      const s = channel / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe.each(['dark', 'light'] as const)('%s chart palette', (theme) => {
  const { panel, text, volume, ...series } = chartColors[theme];
  const backdrop = rgb(panel);
  it('keeps axis text, plotted series and their last-price labels readable', () => {
    expect(contrast(rgb(text), backdrop)).toBeGreaterThanOrEqual(4.5);
    for (const hex of Object.values(volume)) {
      expect(contrast(rgb(hex), backdrop)).toBeGreaterThanOrEqual(3);
    }
    for (const [name, hex] of Object.entries(series)) {
      const color = rgb(hex);
      expect(contrast(color, backdrop), name).toBeGreaterThanOrEqual(3);
      // The locked Lightweight Charts version selects its own label ink.
      const [r, g, b] = color;
      const ink =
        0.199 * r + 0.687 * g + 0.114 * b > 160 ? '#000000' : '#ffffff';
      expect(contrast(rgb(ink), color), name).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps candles and interval markers distinct from the tinted regime bands', () => {
    for (const color of Object.values(regimes[theme]).map(rgb)) {
      const band = over(color, backdrop, 0x38 / 255);
      for (const foreground of [color, rgb(series.up), rgb(series.down)]) {
        expect(contrast(foreground, band)).toBeGreaterThanOrEqual(3);
      }
    }
  });
});
