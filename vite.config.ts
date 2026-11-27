import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: './',
  build: {
    cssCodeSplit: false,
    target: ['chrome120', 'edge120'],
    ...(mode === 'desktop-6a' && { outDir: 'work/desktop-6a/dist' }),
    rollupOptions: {
      input: [
        'index.html',
        'export.html',
        ...(mode === 'desktop-6a' ? ['tests/desktop-6a/index.html'] : []),
      ],
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/{unit,integration}/**/*.test.{ts,tsx}'],
    clearMocks: true,
  },
}));
