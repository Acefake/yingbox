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
      '.codex_tmp',
      '.claude/worktrees',
      // 第三方 vendored 扩展（CatSpider js 插件），非本仓库源码
      'packages/xptv-extensions-main',
      // 独立部署的下载器前端与内嵌 Python 脚本（各有自己的约定，不随 Electron 应用发版）
      'packages/services/frontend',
      'packages/services/backend/py',
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
