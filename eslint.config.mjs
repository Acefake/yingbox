import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginVue from 'eslint-plugin-vue'
import vueParser from 'vue-eslint-parser'

export default tseslint.config(
  {
    ignores: [
      '**/node_modules',
      '**/dist',
      '**/out',
      '**/dist-web',
      '**/dist-renderer',
      // 本地临时目录与 agent 工作树（已在 .gitignore，避免 lint 解析构建产物/仓库副本）
      '.claude/worktrees',
      // Go 后端内嵌的 Python/Node 脚本（各有自己的约定）
      'packages/backend/py',
      // 手动跑的截图 / 性能驾驭（Playwright 脚本，不进应用）
      'scripts/ui-harness',
    ],
  },
  tseslint.configs.recommended,
  eslintPluginVue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
        extraFileExtensions: ['.vue'],
        parser: tseslint.parser,
      },
    },
  },
  {
    files: ['**/*.{ts,mts,tsx,vue}'],
    rules: {
      // Vue 相关规则
      'vue/require-default-prop': 'off',
      'vue/multi-word-component-names': 'off',
      'vue/block-lang': [
        'error',
        {
          script: {
            lang: 'ts',
          },
        },
      ],

      // 导入排序规则
      'prefer-template': 'error',
      'sort-imports': [
        'error',
        {
          ignoreCase: false,
          ignoreDeclarationSort: true,
          ignoreMemberSort: false,
          memberSyntaxSortOrder: ['none', 'all', 'multiple', 'single'],
          allowSeparatedGroups: true,
        },
      ],

      // 以下两条为提醒级：仓库现状（尤其是渲染层）大量有意使用 any / 省略返回类型，
      // 保持可见但不阻塞 lint 通过。
      '@typescript-eslint/explicit-function-return-type': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',

      // 下划线前缀表示有意忽略（占位参数/解构忽略项）
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // 空行规则：函数声明前后需要空行（不约束 import 之间，也不在函数体内强制）
      'padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: '*', next: 'function' },
        { blankLine: 'always', prev: 'function', next: '*' },
      ],

      // Vue 相关规则
      'vue/return-in-computed-property': 'error',
    },
  },

  {
    // IPC 只能经契约（src/shared/contract）：ipcMain / ipcRenderer / webContents.send
    // 只允许出现在通用注册器 src/main/rpc 与通用 preload 里。
    // src/main/library/host.ts 属于影视项目的媒体库引擎（自带 IPC），合并前不动它。
    files: ['src/**/*.{ts,mts,vue}'],
    ignores: ['src/main/rpc/**', 'src/preload/**', 'src/main/library/host.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'electron',
              importNames: ['ipcMain', 'ipcRenderer'],
              message: '在 src/shared/contract 声明通道，主进程用 main/rpc 的 implement / emit。',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='send'][callee.object.property.name='webContents']",
          message: '事件请在契约里声明，并用 main/rpc 的 emit 推送。',
        },
      ],
    },
  },

  {
    // 纯 JS/MJS 文件不适用 TS 的返回类型规则
    files: ['**/*.{js,mjs,cjs}'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
    },
  },
  {
    // 声明文件里的三斜线引用是常规用法
    files: ['**/*.d.ts'],
    rules: {
      '@typescript-eslint/triple-slash-reference': 'off',
    },
  },

  // === Prettier 配置必须放在最后 ===
  eslintConfigPrettier
)
