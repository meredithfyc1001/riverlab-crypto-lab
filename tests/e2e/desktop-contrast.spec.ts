import { expect } from '@playwright/test';
import { test } from './desktop-fixture';
import routes from '../desktop-6a/sections.json' with { type: 'json' };

// Evaluate in the rendering engine so inherited colors, placeholders and group
// opacity (including disabled fieldsets) participate in the WCAG calculation.
function contrastFailures() {
  type Color = [number, number, number, number];
  function parse(css: string): Color {
    const match = /^rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)$/.exec(
      css,
    );
    if (!match) throw new Error('Unexpected computed color: ' + css);
    return [
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
      Number(match[4] ?? 1),
    ];
  }
  function over(top: Color, bottom: Color): Color {
    const remainder = bottom[3] * (1 - top[3]);
    const alpha = top[3] + remainder;
    if (!alpha) return [0, 0, 0, 0];
    return [
      (top[0] * top[3] + bottom[0] * remainder) / alpha,
      (top[1] * top[3] + bottom[1] * remainder) / alpha,
      (top[2] * top[3] + bottom[2] * remainder) / alpha,
      alpha,
    ];
  }
  function luminance(color: Color) {
    const [r, g, b] = color.slice(0, 3).map((channel) => {
      const s = channel / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  const failures: string[] = [];
  let checks = 0;
  const minima = { text: 21, largeText: 21, graphics: 21 };
  function check(
    el: Element,
    label: string,
    ink: Color,
    paper: Color,
    kind: keyof typeof minima,
  ) {
    for (let layer: Element | null = el; layer; layer = layer.parentElement) {
      const style = getComputedStyle(layer);
      const background = parse(style.backgroundColor);
      ink = over(ink, background);
      paper = over(paper, background);
      ink[3] *= Number(style.opacity);
      paper[3] *= Number(style.opacity);
    }
    if (paper[3] !== 1) throw new Error('Page backdrop must be explicit');
    const l1 = luminance(ink),
      l2 = luminance(paper);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    checks++;
    minima[kind] = Math.min(minima[kind], ratio);
    const minimum = kind === 'text' ? 4.5 : 3;
    if (ratio < minimum) {
      failures.push(
        `${label} (${el.localName}${el.id ? '#' + el.id : ''}) ${ratio.toFixed(3)} < ${minimum}`,
      );
    }
  }
  const transparent: Color = [0, 0, 0, 0];
  for (const el of Array.from(
    document.body.querySelectorAll<HTMLElement>('*'),
  )) {
    if (
      !el.checkVisibility() ||
      el.closest('.sr-only, svg, script, style, option')
    )
      continue;
    const style = getComputedStyle(el);
    const text = Array.from(el.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent)
      .join('')
      .trim();
    const input =
      el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
    const field =
      input && !el.matches('[type=checkbox], [type=radio], [type=hidden]');
    const label =
      text ||
      (field && el.value) ||
      (el instanceof HTMLSelectElement && el.selectedOptions[0]?.text);
    const minimum =
      parseFloat(style.fontSize) >= 24 ||
      (parseFloat(style.fontSize) >= 56 / 3 && Number(style.fontWeight) >= 700)
        ? 'largeText'
        : 'text';
    if (label || (field && el.matches('[type=file]'))) {
      check(
        el,
        (label || 'file name').slice(0, 28),
        parse(style.webkitTextFillColor),
        transparent,
        minimum,
      );
    }
    if (field && el.matches(':placeholder-shown') && el.placeholder) {
      const placeholder = getComputedStyle(el, '::placeholder');
      const ink = parse(placeholder.color);
      ink[3] *= Number(placeholder.opacity);
      check(el, 'placeholder ' + el.placeholder, ink, transparent, minimum);
    }
    if (field && el.matches('[type=file]')) {
      const button = getComputedStyle(el, '::file-selector-button');
      check(
        el,
        'file chooser',
        over(parse(button.color), parse(button.backgroundColor)),
        parse(button.backgroundColor),
        minimum,
      );
    }
    if (
      field ||
      el instanceof HTMLSelectElement ||
      el instanceof HTMLButtonElement
    ) {
      // A thin control boundary must be distinguishable from its surrounding surface.
      if (
        style.borderTopStyle !== 'none' &&
        parseFloat(style.borderTopWidth) > 0
      ) {
        check(
          el.parentElement!,
          'control border ' +
            (el.getAttribute('aria-label') || label || el.tagName).slice(0, 28),
          parse(style.borderTopColor),
          transparent,
          'graphics',
        );
      }
    }
    if (el.matches(':focus-visible')) {
      if (style.outlineStyle === 'none')
        failures.push('Missing focus outline: ' + el.tagName);
      else
        check(
          el.parentElement!,
          'focus outline',
          parse(style.outlineColor),
          transparent,
          'graphics',
        );
    }
    if (el.matches('.nav-dot, .status-dot')) {
      check(
        el.parentElement!,
        el.className,
        parse(style.backgroundColor),
        transparent,
        'graphics',
      );
    }
  }
  return { checks, failures, minima };
}

test('desktop text, disabled controls, hints and control boundaries meet WCAG contrast', async ({
  page,
  desktopOrigin: origin,
}, testInfo) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ colorScheme: 'dark' });
  const results: {
    view: string;
    checks: number;
    minima: ReturnType<typeof contrastFailures>['minima'];
  }[] = [];
  async function audit(view: string) {
    const { checks, failures, minima } = await page.evaluate(contrastFailures);
    expect(checks, view).toBeGreaterThan(0);
    expect.soft(failures, view).toEqual([]);
    results.push({ view, checks, minima });
  }
  for (const theme of ['dark', 'light']) {
    for (const [route, [, section]] of Object.entries(routes)) {
      await page.goto(origin + '/#/' + route);
      if (theme === 'light' && route === 'overview') {
        await page.getByRole('button', { name: '切换为浅色主题' }).click();
      }
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      // The card background transitions for 150 ms when the theme changes.
      await page.evaluate(() =>
        Promise.all(
          document.getAnimations().map((animation) => animation.finished),
        ),
      );
      await page
        .getByRole('heading', { level: 2, name: section, exact: true })
        .waitFor();
      await page
        .locator('details')
        .evaluateAll((items) =>
          items.forEach((item) => item.setAttribute('open', '')),
        );
      await page.keyboard.press('Tab');
      await expect(page.locator(':focus-visible')).toHaveCount(1);
      await audit(theme + '/' + route);
      if (route === 'datasets') {
        await page
          .getByRole('button', { name: '错误测试样本 · 人工构造' })
          .click();
        await page.getByText('读到 9 条数据记录。', { exact: false }).waitFor();
        await audit(theme + '/import-placeholders');
        await page.getByLabel('预期固定周期（秒）').fill('60');
        await page.getByRole('button', { name: '检查并生成导入报告' }).click();
        await page.getByText('存在阻断错误').waitFor();
        await audit(theme + '/import-errors');
      }
    }
  }

  // The SQLite section is shown only when the packaged frontend sees the desktop bridge.
  await page.addInitScript(() =>
    Object.defineProperty(window, '__TAURI__', {
      value: { core: { invoke: () => Promise.reject('合成错误提示') } },
    }),
  );
  await page.goto(origin + '/tests/desktop-6a/index.html');
  await page.locator('#status[data-state=ready]').waitFor();
  await expect(page.locator('#download')).toBeDisabled();
  await page.locator('#sqlite').click();
  await page.locator('#sqlite-status[data-state=failed]').waitFor();
  await audit('desktop probe');
  await testInfo.attach('contrast-results.json', {
    contentType: 'application/json',
    body: JSON.stringify(results, null, 2),
  });
});
