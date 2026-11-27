import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { DesktopStorage } from '../../src/app/DesktopStorage';

afterEach(() => {
  vi.unstubAllGlobals();
});

it('queries the native service on demand and displays verified backup and integrity receipts', async () => {
  const user = userEvent.setup();
  const invoke = vi
    .fn()
    .mockResolvedValueOnce({
      status: 'running',
      serviceVersion: '0.6.1',
      protocolVersion: 1,
      schemaVersion: 1,
      dataDirectory: 'C:/测试 账户/研究数据',
      availableBytes: 2 ** 30,
    })
    .mockResolvedValueOnce('ok')
    .mockResolvedValueOnce('C:/测试 账户/研究数据/backups/example.sqlite3');
  vi.stubGlobal('__TAURI__', { core: { invoke } });
  render(<DesktopStorage />);
  expect(invoke).not.toHaveBeenCalled();
  await user.click(
    screen.getByRole('button', { name: '查看数据目录与服务状态' }),
  );
  expect(await screen.findByText('C:/测试 账户/研究数据')).toBeVisible();
  expect(screen.getByText('1 GiB')).toBeVisible();
  await user.click(screen.getByRole('button', { name: '检查数据库完整性' }));
  expect(await screen.findByText('数据库完整性检查通过。')).toBeVisible();
  await user.click(screen.getByRole('button', { name: '创建数据库备份' }));
  expect(await screen.findByText(/备份已保存至 C:\/测试 账户/)).toBeVisible();
  expect(invoke.mock.calls).toEqual([
    ['local_service_health'],
    ['local_service_integrity'],
    ['local_service_backup'],
  ]);
});

it('displays a failed check and allows retry without reporting success', async () => {
  const user = userEvent.setup();
  const invoke = vi
    .fn()
    .mockRejectedValueOnce('目录读写检查失败')
    .mockResolvedValueOnce('ok');
  vi.stubGlobal('__TAURI__', { core: { invoke } });
  render(<DesktopStorage />);
  await user.click(
    screen.getByRole('button', { name: '查看数据目录与服务状态' }),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    '目录读写检查失败',
  );
  expect(screen.queryByText('服务运行中，目录可写')).toBeNull();
  await user.click(screen.getByRole('button', { name: '检查数据库完整性' }));
  expect(await screen.findByText('数据库完整性检查通过。')).toBeVisible();
  expect(screen.queryByRole('alert')).toBeNull();
});
