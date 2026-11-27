import { expect, type Page } from '@playwright/test';

const message = '回测成功；结果尚未保存，刷新会丢失。';
const budgetMs = 5000;

export async function runAndExpectBacktestSuccess(page: Page) {
  const success = page.getByText(message, { exact: true });
  expect(await success.isVisible(), '运行前没有上次的成功提示').toBe(false);
  const run = await page
    .getByRole('button', { name: '运行回测', exact: true })
    .elementHandle();
  // Arm before clicking. Playwright's locator retries can miss a painted
  // result near the deadline while the main thread is drawing the charts.
  const observation = await run.evaluateHandle(
    (button, { message, budgetMs }) => {
      const ready = new Promise<number | null>((resolve) => {
        button.addEventListener(
          'click',
          () => {
            const start = performance.now();
            const sample = () => {
              const visible = Array.from(
                document.querySelectorAll('[role="status"]'),
              ).some((element) => {
                if (element.textContent !== message) return false;
                const { width, height } = element.getBoundingClientRect();
                return (
                  width > 0 &&
                  height > 0 &&
                  getComputedStyle(element).visibility === 'visible'
                );
              });
              const elapsed = performance.now() - start;
              if (visible || elapsed >= budgetMs) {
                clearTimeout(timer);
                resolve(visible && elapsed <= budgetMs ? elapsed : null);
              } else frame = requestAnimationFrame(sample);
            };
            let frame = requestAnimationFrame(sample);
            const timer = setTimeout(() => {
              cancelAnimationFrame(frame);
              resolve(null);
            }, budgetMs);
          },
          { capture: true, once: true },
        );
      });
      return { ready };
    },
    { message, budgetMs },
  );
  try {
    await run.click();
    const elapsed = await observation.evaluate(({ ready }) => ready);
    expect(elapsed, '真实点击后五秒内可见回测成功提示').not.toBeNull();
    expect(await success.isVisible()).toBe(true);
  } finally {
    await observation.dispose();
    await run.dispose();
  }
}
