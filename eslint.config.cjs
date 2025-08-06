const eslintConfigPrettier = require('eslint-config-prettier')
const tsParser = require('@typescript-eslint/parser')
const tsEslint = require('@typescript-eslint/eslint-plugin')
const tseslint = require('typescript-eslint')

module.exports = [
  {
    files: ['**/*.ts', 'src/**/*.js', '**/*.cjs'],
  },
  {
    ignores: [
      'dist',
      'eslint.config.cjs',
      'node_modules',
      'tsconfig.json',
      'build.config.ts',
      '**/*.d.ts',
    '.github',
    'eslint-rules/',
    ],
  },
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
        sourceType: 'module',
      },
    },
  },
  {
    plugins: {
      'custom-rules': require('./eslint-rules/no-spread-after-defaults.js').default,
    },
    rules: {
      'no-multiple-empty-lines': 'error',
      quotes: ['error', 'single', { allowTemplateLiterals: true }],
      semi: ['error', 'never'],
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-unused-expressions': [
        'error',
        {
          allowShortCircuit: true,
          allowTernary: true,
        },
      ],
      '@typescript-eslint/prefer-nullish-coalescing': ['error'],
      'custom-rules/no-spread-after-defaults': 'error',
    },
  },
]
