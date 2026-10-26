/**
 * 统一入口（搜索与 AI 助手共用的居中浮层）用到的片库搜索，按需加载成单独的块：
 * 浮层第一次打开时与浮层一起下载（loadLibrarySearch），不进入应用入口块，也不并进 AI 助手核心的块。
 */
export {
  type LibrarySearch,
  type SearchEntry,
  librarySearchScope,
  librarySectionLabel,
  useLibrarySearch,
} from './use-library-search'
export { default as SearchMatches } from './SearchMatches.vue'
export { default as VisualSourceSelect } from '../visual/VisualSourceSelect.vue'
