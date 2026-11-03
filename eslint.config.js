// @ts-check
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/test/fixtures/**',
      'examples/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            'eslint.config.js',
            'packages/cli/bin/*.js',
            'packages/*/scripts/*.js',
            'scripts/*.js',
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // Conflicts with no-non-null-assertion; we prefer explicit `as` casts after checks.
      '@typescript-eslint/non-nullable-type-assertion-style': 'off',
      eqeqeq: ['error', 'always'],
      'no-console': 'error',
    },
  },
  prettier,
);
