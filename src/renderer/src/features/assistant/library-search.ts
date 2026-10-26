/**
 * 统一入口用的片库搜索模块（片库 feature 按需加载的块）：浮层的异步加载器先把它取来再挂浮层
 * （AssistantLauncher），浮层里同步取用。这样片库搜索不并进助手核心的块。
 */
import { type LibrarySearchModule, loadLibrarySearch } from '@/features/library'

let loaded: LibrarySearchModule | null = null

/** 取来片库搜索模块（只取一次） */
export async function prepareLibrarySearch(): Promise<void> {
  loaded ??= await loadLibrarySearch()
}

/** 已取来的片库搜索模块（浮层挂载前由 prepareLibrarySearch 准备好） */
export function librarySearchModule(): LibrarySearchModule {
  if (!loaded) throw new Error('片库搜索模块还没加载')
  return loaded
}
