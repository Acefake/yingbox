/**
 * 应用内自动安装的 mpv 版本要与 scripts/fetch-mpv.mjs 一致（两处各写一份常量）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' }, net: {} }))

describe('mpv-install', () => {
  it('版本与 fetch-mpv.mjs 相同', async () => {
    const { MPV_RELEASE, MPV_ARCHIVE, MPV_SHA256 } =
      await import('../src/main/mpv-install')
    const script = readFileSync('scripts/fetch-mpv.mjs', 'utf8')
    expect(script).toContain(`const RELEASE = '${MPV_RELEASE}'`)
    expect(script.match(/const SHA256\s*=\s*'([^']+)'/)?.[1]).toBe(MPV_SHA256)
    expect(script).toContain(MPV_ARCHIVE.replace(MPV_RELEASE, '${RELEASE}'))
  })

  it('拒绝内容不匹配的下载文件', async () => {
    const { verifyMpvArchive } = await import('../src/main/mpv-install')
    await expect(verifyMpvArchive('package.json')).rejects.toThrow('校验失败')
  })

  it('非 Windows 不自动安装', async () => {
    const { canInstallMpv } = await import('../src/main/mpv-install')
    if (process.platform !== 'win32') expect(canInstallMpv()).toBe(false)
  })
})
