import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { args: 'none', ignoreRestSiblings: true },
      ],
      'no-console': 'off',
    },
  },
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.cache/**',
      '**/.data/**',
      '**/components/ui/**',
    ],
  }
);
