import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

const folders = (...names) =>
  names.flatMap((name) => [`**/${name}`, `**/${name}/**`]);
const featureNames = [
  'datasets',
  'charts',
  'strategies',
  'backtests',
  'risk',
  'experiments',
  'replay',
  'portfolio',
];

export default tseslint.config(
  {
    ignores: [
      'dist',
      'node_modules',
      'work',
      'playwright-report',
      'test-results',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.node } } },
  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'error',
        { allowConstantExport: true },
      ],
    },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            'react',
            'react/*',
            'react-dom',
            'react-dom/*',
            ...folders('app', 'features', 'components', 'infrastructure'),
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        'window',
        'document',
        'localStorage',
        'indexedDB',
        'fetch',
        'WebSocket',
      ],
    },
  },
  ...featureNames.map((name) => ({
    files: [`src/features/${name}/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...folders('app', 'features'),
            ...featureNames
              .filter((other) => other !== name)
              .flatMap((other) => [`../${other}`, `../${other}/**`]),
          ],
        },
      ],
    },
  })),
  {
    files: ['src/components/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: folders('app', 'features') },
      ],
    },
  },
  {
    files: ['src/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            'react',
            'react/*',
            'react-dom',
            'react-dom/*',
            ...folders(
              'app',
              'features',
              'components',
              'infrastructure',
              'core',
            ),
          ],
        },
      ],
    },
  },
);
