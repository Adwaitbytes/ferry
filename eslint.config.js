import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import security from 'eslint-plugin-security';

// Untrusted text (memory facts, imported chats, page DOM) flows through every surface,
// so sinks that parse HTML or evaluate strings are banned repo-wide, not per package.
const bannedSinks = [
  {
    selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
    message: 'dangerouslySetInnerHTML is banned. Render text nodes only.',
  },
  {
    selector: "AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]",
    message: 'innerHTML/outerHTML assignment is banned. Use textContent or DOM APIs.',
  },
  {
    selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
    message: 'insertAdjacentHTML is banned.',
  },
  {
    selector: "CallExpression[callee.property.name='write'][callee.object.name='document']",
    message: 'document.write is banned.',
  },
  { selector: "NewExpression[callee.name='Function']", message: 'new Function is banned.' },
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.output/**',
      '**/.wxt/**',
      '**/coverage/**',
      '**/next-env.d.ts',
      '**/*.config.{js,mjs,cjs}',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  security.configs.recommended,
  {
    rules: {
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-script-url': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-restricted-syntax': ['error', ...bannedSinks],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // Index access on typed records is pervasive and safe under noUncheckedIndexedAccess.
      'security/detect-object-injection': 'off',
    },
  },
  {
    files: ['**/scripts/**', '**/examples/**', '**/*.test.ts', '**/*.spec.ts', '**/e2e/**'],
    rules: { 'no-console': 'off' },
  },
  // DESIGN 6: no "AI magic" iconography anywhere in the UI.
  {
    files: ['packages/ui/**/*.{ts,tsx}', 'apps/web/**/*.{ts,tsx}', 'apps/extension/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'lucide-react',
              importNames: [
                'Sparkles', 'Sparkle', 'WandSparkles', 'Wand', 'Wand2', 'Brain', 'BrainCircuit', 'BrainCog',
                'Bot', 'BotMessageSquare', 'BotOff', 'Stars', 'Zap',
              ],
              message: 'Banned icon (DESIGN 6). Ferry never uses sparkle, wand, brain, bot or star icons.',
            },
          ],
        },
      ],
    },
  },
);
