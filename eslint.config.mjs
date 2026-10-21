import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginVue from 'eslint-plugin-vue'
import vueParser from 'vue-eslint-parser'
import yingbox from './scripts/eslint/feature-boundaries.mjs'

/**
 * 渲染层禁止直接 fetch：外网请求经 @/api/online（引擎 net 出网，带 SSRF 防护）。
 * 豁免 services/library-server/index.ts——网页端访问同源的独立片库服务（src/server）。
 * 与 localStorage 禁令同属 no-restricted-globals，flat config 后者会覆盖前者，
 * 所以 localStorage 那段也带上 fetch 禁令。
 */
const fetchGlobalBan = {
  name: 'fetch',
  message: '渲染层不直连网络，改用 @/api/online（引擎 net 出网）。',
}
const fetchPropertyBans = ['window', 'globalThis'].map(object => ({
  object,
  property: 'fetch',
  message: fetchGlobalBan.message,
}))

/**
 * no-restricted-imports 在 flat config 里同样是后者覆盖前者（不合并），
 * 所以各处禁令放在一起：ipcImportBan 给整个 src，renderer 再加上 axios。
 */
const ipcImportBan = {
  name: 'electron',
  importNames: ['ipcMain', 'ipcRenderer'],
  message:
    '在 src/shared/contract 声明通道，主进程用 main/rpc 的 implement / emit。',
}
/** Ant Design 已删除：反馈用 @/components/ui 的 toast / confirmDialog，控件用 Ui* 组件 */
const antdMessage =
  'ant-design-vue 已移除：提示用 @/components/ui 的 toast，确认用 confirmDialog，控件用 Ui* 组件。'
const antdImportBan = {
  paths: [{ name: 'ant-design-vue', message: antdMessage }],
  patterns: [
    { group: ['ant-design-vue/*', '@ant-design/*'], message: antdMessage },
  ],
}
const axiosImportBan = {
  name: 'axios',
  message: '渲染层不直连外网，改用 @/api/online（引擎 net 出网）。',
}

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
      // 手动跑的截图 / 性能驾驭（Playwright 脚本，不进应用）
      'scripts/ui-harness',
    ],
  },
  tseslint.configs.recommended,
  eslintPluginVue.configs['flat/recommended'],
  {
    // 全仓禁 antd（src 下的分段会带着这条再加各自的禁令）
    files: ['**/*.{ts,mts,tsx,vue,js,mjs,cjs}'],
    rules: { 'no-restricted-imports': ['error', antdImportBan] },
  },
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
    // 渲染层不直连外网：在线请求经 window.api.online（引擎 net，SSRF 防护）。
    files: ['src/renderer/**/*.{ts,mts,vue}'],
    ignores: ['src/renderer/src/services/library-server/index.ts'],
    rules: {
      'no-restricted-globals': ['error', fetchGlobalBan],
      'no-restricted-properties': ['error', ...fetchPropertyBans],
    },
  },

  {
    // IPC 只能经契约（src/shared/contract）：ipcMain / ipcRenderer / webContents.send
    // 只允许出现在通用注册器 src/main/rpc 与通用 preload 里。
    // 例外：src/main/library/host.ts 是媒体库引擎的桥（一个 invoke 通道 + MessagePort 事件流，
    // 自带 shared/library/ipc 的校验与 wire 格式），保留独立桥接而不并进契约，见 docs/library-refactor。
    files: ['src/**/*.{ts,mts,vue}'],
    ignores: ['src/main/rpc/**', 'src/preload/**', 'src/main/library/host.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [ipcImportBan, ...antdImportBan.paths],
          patterns: antdImportBan.patterns,
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name='send'][callee.object.property.name='webContents']",
          message: '事件请在契约里声明，并用 main/rpc 的 emit 推送。',
        },
      ],
    },
  },

  {
    // 渲染层在上一段的基础上再禁 axios；必须排在它后面，否则会被覆盖
    files: ['src/renderer/**/*.{ts,mts,vue}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [ipcImportBan, ...antdImportBan.paths, axiosImportBan],
          patterns: antdImportBan.patterns,
        },
      ],
    },
  },

  {
    // 设置一律经 features/settings 的 useSetting / getSetting，渲染层禁止直接用 localStorage。
    files: ['src/renderer/**/*.{ts,mts,vue}'],
    ignores: [
      // 设置层自身：首启迁移读旧值、Web/PWA 模式的浏览器存储
      'src/renderer/src/features/settings/browser-storage.ts',
      // 数据而非设置（播放进度、搜索历史、源选择、AV 目录缓存），后续迁到 Engine 的 SQLite
      'src/renderer/src/features/player/utils/play-progress.ts',
      'src/renderer/src/utils/storage.ts',
      'src/renderer/src/features/av/composables/use-av-browse.ts',
      'src/renderer/src/features/online/components/LibraryCollection.vue',
      'src/renderer/src/features/online/components/SearchTab.vue',
      'src/renderer/src/features/online/composables/catspider-sites.ts',
    ],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'localStorage',
          message: '设置请用 features/settings 的 useSetting / getSetting。',
        },
        fetchGlobalBan,
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'window',
          property: 'localStorage',
          message: '设置请用 features/settings 的 useSetting / getSetting。',
        },
        ...fetchPropertyBans,
      ],
    },
  },

  {
    // 片库服务客户端可以同源 fetch（见文件头说明），localStorage 禁令照旧；必须排在上一段之后才能覆盖它
    files: ['src/renderer/src/services/library-server/index.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'localStorage',
          message: '设置请用 features/settings 的 useSetting / getSetting。',
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'window',
          property: 'localStorage',
          message: '设置请用 features/settings 的 useSetting / getSetting。',
        },
      ],
    },
  },

  {
    // feature 之间只能经 features/<x>/index.ts 公共出口互相引用（规则见 scripts/eslint/feature-boundaries.mjs）
    files: ['src/renderer/src/features/**/*.{ts,mts,vue}'],
    plugins: { yingbox },
    rules: { 'yingbox/feature-boundaries': 'error' },
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
