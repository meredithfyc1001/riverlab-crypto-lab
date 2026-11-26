import { rm } from 'node:fs/promises';
import { test as base } from '@playwright/test';
import { build, preview } from 'vite';

export const test = base.extend<{ desktopOrigin: string }>({
  desktopOrigin: async ({ browserName }, use, testInfo) => {
    const outDir = testInfo.outputPath('desktop-' + browserName);
    await build({ mode: 'desktop-6a', logLevel: 'error', build: { outDir } });
    const server = await preview({
      configFile: false,
      build: { outDir },
      preview: { host: '127.0.0.1', port: 0 },
    });
    try {
      const address = server.httpServer.address();
      if (!address || typeof address === 'string')
        throw new Error('Desktop preview needs a TCP port');
      await use('http://127.0.0.1:' + address.port);
    } finally {
      await server.close();
      await rm(outDir, { recursive: true, force: true });
    }
  },
});
