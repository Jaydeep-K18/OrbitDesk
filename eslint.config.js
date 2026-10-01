// Root ESLint flat config shared by every TypeScript workspace.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.output/**',
      '**/.wxt/**',
      '**/coverage/**',
      '**/node_modules/**',
      'apps/collector/**',
      'apps/ml-service/**',
      '**/*.config.{js,ts,mjs}',
      '**/prisma/generated/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      eqeqeq: ['error', 'always'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}', 'apps/extension/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    // The domain package must stay pure: no I/O, no framework imports.
    files: ['packages/domain/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: ['express', 'node:*', 'fs', 'path', '@prisma/*', 'react', 'react-dom'],
        },
      ],
    },
  },
  {
    files: ['**/*.test.{ts,tsx}', '**/tests/**', 'infra/scripts/**', '**/scripts/**'],
    rules: { 'no-console': 'off' },
  },
  prettier,
);
