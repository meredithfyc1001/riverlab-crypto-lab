import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/app/App';

describe('Phase 0 应用框架', () => {
  it('首次进入展示中文工作台、合成数据及研究风险提示', () => {
    render(<App />);
    expect(
      screen.getByRole('heading', { level: 1, name: '工作台' }),
    ).toBeVisible();
    expect(
      within(screen.getByRole('navigation')).getAllByRole('link'),
    ).toHaveLength(8);
    expect(screen.getByText(/以下为人工合成数据，不是真实行情/)).toBeVisible();
    expect(screen.getByRole('table')).toHaveTextContent('2026-01-01 00:00');
    expect(screen.getByLabelText('研究风险提示')).toHaveTextContent(
      '历史表现不代表未来表现',
    );
  });

  it('默认深色，可通过键盘操作切换主题', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    screen.getByRole('button', { name: '切换为浅色主题' }).focus();
    await user.keyboard('{Enter}');
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    await user.click(screen.getByRole('button', { name: '切换为深色主题' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
  });

  it('深链接指向回测配置，未选保存数据不能运行且无账户输入', async () => {
    window.history.replaceState(null, '', '/#/backtests');
    render(<App />);
    expect(
      screen.getByRole('heading', { level: 1, name: '回测中心' }),
    ).toBeVisible();
    expect(
      await screen.findByRole('heading', { name: '回测配置' }),
    ).toBeVisible();
    expect(
      screen.queryByLabelText(/API Key|私钥|账户密码/),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '运行回测' })).toBeDisabled();
    expect(screen.getByLabelText('研究风险提示')).toBeVisible();
  });

  it('响应浏览器 hash 变更，未知地址回到工作台', () => {
    render(<App />);
    act(() => {
      window.history.replaceState(null, '', '/#/risk');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(
      screen.getByRole('heading', { level: 1, name: '风险中心' }),
    ).toBeVisible();
    expect(
      within(screen.getByRole('navigation')).getByRole('link', {
        name: '风险中心',
      }),
    ).toHaveAttribute('aria-current', 'page');
    act(() => {
      window.history.replaceState(null, '', '/#/unknown');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(
      screen.getByRole('heading', { level: 1, name: '工作台' }),
    ).toBeVisible();
  });
});
