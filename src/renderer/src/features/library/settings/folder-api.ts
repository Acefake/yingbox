/**
 * 片库服务的目录浏览接口（网页端添加媒体库用）。
 */
import {
  type DirectoryListing,
  LIBRARY_HTTP,
} from '../../../../../shared/library/ipc'
import { serverFetch } from '@/services/library-server'

/** 读服务上的一个目录；path 为 null 时列出媒体根目录。 */
export async function fetchDirectory(
  path: string | null
): Promise<DirectoryListing> {
  const query = path ? `?path=${encodeURIComponent(path)}` : ''
  const response = await serverFetch(`${LIBRARY_HTTP.dirs}${query}`)
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string
    } | null
    throw new Error(body?.error ?? `读取目录失败（HTTP ${response.status}）`)
  }
  return (await response.json()) as DirectoryListing
}
