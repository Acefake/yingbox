import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginVue from 'eslint-plugin-vue'
import vueParser from 'vue-eslint-parser'

export default tseslint.config(
  { ignores: ["**/node_modules", "**/dist", "**/out"] },
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
          order: ['defineProps', 'defineEmits', 'defineExpose'],
        },
      ],
      'vue/block-lang': [
        'error',
        {
          script: {
            lang: 'ts',

      // 导入排序规则
      'prefer-template': 'error',

      // === 导入排序规则 ===
      'sort-imports': [
        'error',
        {
          ignoreCase: false,
          ignoreDeclarationSort: true,
          ignoreMemberSort: false,
          memberSyntaxSortOrder: ['none', 'all', 'multiple', 'single'],
          allowSeparatedGroups: true,
      // 函数间空行规则
      ],

        // 函数声明前后需要空行
      'padding-line-between-statements': [
        'error',
        // 箭头函数表达式前后需要空行
        { blankLine: 'always', prev: '*', next: 'function' },
        { blankLine: 'always', prev: 'function', next: '*' },
        // 类声明前后需要空行
        { blankLine: 'always', prev: '*', next: 'const' },
        { blankLine: 'always', prev: 'const', next: '*' },
        // 导入语句后需要空行
        { blankLine: 'always', prev: '*', next: 'type' },
        { blankLine: 'always', prev: 'type', next: '*' },
        // 导出语句前需要空行
        { blankLine: 'always', prev: 'import', next: '*' },
        // 块语句前后空行

      // Prettier 配置
      'vue/return-in-computed-property': 'error',

      // === Prettier 配置 ===
        'error',
        {
          // 基础格式化选项
          singleQuote: true,
          semi: false,
          printWidth: 80,
          tabWidth: 2,
          useTabs: false,
          printWidth: 100,
          quoteProps: 'as-needed',
          jsxSingleQuote: true,
          embeddedLanguageFormatting: 'auto',
        },
  },

  // === Prettier 配置必须放在最后 ===
  eslintConfigPrettier
)
