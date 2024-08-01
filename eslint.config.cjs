const eslintConfigPrettier = require('eslint-config-prettier');
const tsParser = require('@typescript-eslint/parser');
const tsEslint = require('@typescript-eslint/eslint-plugin');
const tseslint = require('typescript-eslint');

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
		]
	},
	...tseslint.configs.recommended,
	eslintConfigPrettier,
	{
		languageOptions: {
			parser: tsParser,
		}
	},
	{
		rules: {
			'no-multiple-empty-lines': 'error',
			quotes: ['error', 'single', { allowTemplateLiterals: true }],
			semi: 'off',
			'@typescript-eslint/semi': ['error', 'never'],
			'@typescript-eslint/member-delimiter-style': [
				'error',
				{
					multiline: {
						delimiter: 'none',
						requireLast: true,
					},
					singleline: {
						delimiter: 'semi',
						requireLast: false,
					},
					multilineDetection: 'brackets',
				},
			],
			'@typescript-eslint/no-unused-vars': [
				'warn',
				{
					argsIgnorePattern: '^_',
					varsIgnorePattern: '^_',
					caughtErrorsIgnorePattern: '^_',
					destructuredArrayIgnorePattern: '^_',
				},
			],
		},
	}
];
