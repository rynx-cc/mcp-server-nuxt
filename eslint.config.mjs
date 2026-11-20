import antfu from '@antfu/eslint-config';

export default antfu(
  {
    type: 'lib',
    typescript: true,
    vue: false,
    // Markdown linting currently crashes under ESLint 10 + @eslint/plugin-kit.
    markdown: false,
    // Do not enforce contributor machine-local pnpm settings into the repo.
    pnpm: false,
    // Keep stylistic close to the existing tree (semicolons / 1tbs), but turn
    // off layout rules that would mass-rewrite newlines, import order, etc.
    stylistic: {
      indent: 2,
      quotes: 'single',
      semi: true,
      braceStyle: '1tbs',
    },
    ignores: [
      'dist/**',
      '**/.nuxt/**',
      '**/node_modules/**',
      'tests/fixtures/**',
    ],
  },
  {
    rules: {
      // ESM Node library: prefer Node globals over CommonJS require().
      'node/prefer-global/process': 'off',
      'node/prefer-global/buffer': 'off',
      // Allow intentional `while ((m = re.exec(...)))` parser idiom.
      'no-cond-assign': ['error', 'except-parens'],

      // Match existing code shape; do not force a repo-wide reformat.
      'style/arrow-parens': ['error', 'always'],
      'style/operator-linebreak': 'off',
      'style/quotes': 'off',
      'style/quote-props': 'off',
      'style/indent-binary-ops': 'off',
      'antfu/if-newline': 'off',
      'antfu/reasonable-newline': 'off',
      'antfu/consistent-list-newline': 'off',
      'antfu/curly': 'off',
      'perfectionist/sort-imports': 'off',
      'perfectionist/sort-named-imports': 'off',
      'jsonc/sort-keys': 'off',
      'ts/consistent-type-definitions': 'off',
      'test/prefer-lowercase-title': 'off',
      'import/consistent-type-specifier-style': 'off',
      // Existing tree uses bracket access, concatenations, and explicit classes.
      'dot-notation': 'off',
      'prefer-template': 'off',
      'no-unneeded-ternary': 'off',
      'regexp/use-ignore-case': 'off',
      'regexp/prefer-w': 'off',
      'regexp/prefer-d': 'off',
      'regexp/no-useless-lazy': 'off',
      'regexp/no-useless-character-class': 'off',
      'regexp/optimal-quantifier-concatenation': 'off',
      'e18e/prefer-object-has-own': 'off',
      'e18e/prefer-timer-args': 'off',
      'unicorn/prefer-type-error': 'off',
    },
  },
);
