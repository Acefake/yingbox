/**
 * 播放列表原文的读取：远程走主进程 http-client（SSRF 防护、大小上限），本地只读 .m3u / .m3u8 / .txt。
 * 编码自动识别（UTF-8 / UTF-16 / GB18030），解析交给渲染层的纯函数。
 */
import { promises as fs } from 'node:fs'
import { extname } from 'node:path'

import { fetchHttp, readLimited } from '../http-client'
import { decodeSubtitleText } from '../subtitle'
import type { PlaylistText } from '../../shared/contract/iptv'

/** 播放列表最大字节数 */
export const PLAYLIST_MAX_BYTES = 16 * 1024 * 1024
/** 允许读取的本地扩展名 */
export const PLAYLIST_EXTENSIONS = ['.m3u', '.m3u8', '.txt']

/** 本地路径是否是允许读取的播放列表 */
export function isPlaylistPath(filePath: string): boolean {
  return PLAYLIST_EXTENSIONS.includes(extname(filePath).toLowerCase())
}

/** 只接受 http / https */
export function isRemoteUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/** 下载远程播放列表 */
export async function fetchPlaylistText(url: string): Promise<PlaylistText> {
  if (!isRemoteUrl(url)) return { ok: false, error: '只支持 http / https 地址' }
  try {
    const response = await fetchHttp(url, {}, 30_000)
    const bytes = await readLimited(response, PLAYLIST_MAX_BYTES)
    return { ok: true, text: decodeSubtitleText(bytes) }
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }
}

/** 读本地播放列表 */
export async function readPlaylistText(
  filePath: string
): Promise<PlaylistText> {
  if (!isPlaylistPath(filePath))
    return { ok: false, error: '只支持 .m3u / .m3u8 / .txt 文件' }
  try {
    const stat = await fs.stat(filePath)
    if (stat.size > PLAYLIST_MAX_BYTES) return { ok: false, error: '文件过大' }
    return { ok: true, text: decodeSubtitleText(await fs.readFile(filePath)) }
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }
}

/** 下载节目单原始字节（.gz 由 epg-store 解压） */
export async function downloadEpgBytes(url: string): Promise<Buffer> {
  if (!isRemoteUrl(url)) throw new Error('只支持 http / https 地址')
  const response = await fetchHttp(url, {}, 60_000)
  return readLimited(response, 64 * 1024 * 1024)
}
