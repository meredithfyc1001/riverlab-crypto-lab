import { expect, test, type Locator, type Page } from '@playwright/test';

async function paintedEdges(page: Page, card: Locator) {
  await card.scrollIntoViewIfNeeded();
  await card.evaluate((el) =>
    Promise.all(el.getAnimations().map((animation) => animation.finished)),
  );
  const screenshot = await page.screenshot({ scale: 'device' });
  return card.evaluate(async (el, image) => {
    const bitmap = await createImageBitmap(
      new Blob([Uint8Array.from(atob(image), (ch) => ch.charCodeAt(0))], {
        type: 'image/png',
      }),
    );
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const bounds = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const scale = devicePixelRatio;
    function pixel(x: number, y: number) {
      const { data } = context.getImageData(Math.round(x), Math.round(y), 1, 1);
      const [r, g, b] = Array.from(data.slice(0, 3), (value) => {
        const s = value / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return r * 0.2126 + g * 0.7152 + b * 0.0722;
    }
    function contrast(a: number, b: number) {
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    }
    // Sample straight segments away from the rounded corners. A border must
    // contrast with both neighbours; a change of fill alone cannot pass.
    const middleX = (bounds.left + bounds.width / 2) * scale;
    const middleY = (bounds.top + bounds.height / 2) * scale;
    // Each row gives the side, its midpoint and the unit vector into the card.
    const sides = [
      ['top', middleX, Math.round(bounds.top * scale), 0, 1],
      ['right', Math.round(bounds.right * scale) - 1, middleY, -1, 0],
      ['bottom', middleX, Math.round(bounds.bottom * scale) - 1, 0, -1],
      ['left', Math.round(bounds.left * scale), middleY, 1, 0],
    ] as const;
    return sides.map(([side, x, y, dx, dy]) => {
      const at = (distance: number) =>
        pixel(x + dx * distance, y + dy * distance);
      const width = parseFloat(
        style.getPropertyValue('border-' + side + '-width'),
      );
      const stroke = style.getPropertyValue('border-' + side + '-style');
      const outside = at(-Math.ceil(2 * scale));
      const inside = at(Math.ceil((width + 2) * scale));
      const pixels = Array.from(
        { length: Math.ceil(width * scale) + 2 },
        (_, i) => at(i - 1),
      );
      const border = pixels.sort(
        (a, b) =>
          Math.min(contrast(b, outside), contrast(b, inside)) -
          Math.min(contrast(a, outside), contrast(a, inside)),
      )[0];
      let focus = null;
      if (el.matches(':focus-visible')) {
        const width = parseFloat(style.outlineWidth);
        const offset = parseFloat(style.outlineOffset);
        const ring = at(-Math.round((offset + width / 2) * scale));
        const surround = at(-Math.ceil((offset + width + 2) * scale));
        focus =
          style.outlineStyle === 'none' || width === 0
            ? 0
            : contrast(ring, surround);
      }
      return {
        side,
        width,
        stroke,
        outside: contrast(border, outside),
        inside: contrast(border, inside),
        focus,
      };
    });
  }, screenshot.toString('base64'));
}

for (const theme of ['dark', 'light'] as const) {
  test(
    'research path card edges and keyboard focus in ' + theme,
    async ({ page }, testInfo) => {
      test.setTimeout(90_000);
      await page.goto('/#/overview');
      if (theme === 'light')
        await page.getByRole('button', { name: '切换为浅色主题' }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const cards = page
        .getByRole('region', { name: '研究路径' })
        .getByRole('link');
      const targets = ['datasets', 'strategies', 'backtests', 'risk'];
      await expect(cards).toHaveCount(targets.length);
      const measurements = [];
      const failures = [];
      for (const state of [
        'default',
        'hover',
        'pressed',
        'keyboard-focus',
      ] as const) {
        await page.mouse.move(0, 0);
        if (state === 'keyboard-focus') {
          await cards.first().focus();
          await page.keyboard.press('Shift+Tab');
        }
        for (const [index, target] of targets.entries()) {
          const card = cards.nth(index);
          await expect(card).toHaveAttribute('href', '#/' + target);
          if (state === 'hover' || state === 'pressed') await card.hover();
          if (state === 'pressed') await page.mouse.down();
          if (state === 'keyboard-focus') await page.keyboard.press('Tab');
          const selector = {
            default: ':not(:hover, :active, :focus-visible)',
            hover: ':hover',
            pressed: ':active',
            'keyboard-focus': ':focus-visible',
          }[state];
          expect(
            await card.evaluate(
              (el, selector) => el.matches(selector),
              selector,
            ),
          ).toBe(true);
          const edges = await paintedEdges(page, card);
          measurements.push({ target, state, edges });
          for (const edge of edges) {
            if (
              edge.width <= 0 ||
              ['none', 'hidden'].includes(edge.stroke) ||
              edge.inside < 3 ||
              edge.outside < 3 ||
              (state === 'keyboard-focus' &&
                (edge.focus === null || edge.focus < 3))
            ) {
              failures.push({ target, state, ...edge });
            }
          }
          if (state === 'pressed') {
            await page.mouse.move(0, 0);
            await page.mouse.up();
          }
        }
      }
      await testInfo.attach('path-card-' + theme + '.json', {
        contentType: 'application/json',
        body: JSON.stringify(measurements, null, 2),
      });
      expect(failures.length, JSON.stringify(failures.slice(0, 4))).toBe(0);
    },
  );
}
