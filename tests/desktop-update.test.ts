import { describe, expect, it } from 'vitest'

import { pickDesktopUpdate } from '../src/shared/desktop-update'

const asset = (
  name: string,
  extra: Record<string, unknown> = {}
): Record<string, unknown> => ({
  name,
  size: 197_000_000,
  digest: `sha256:${'c'.repeat(64)}`,
  browser_download_url: `https://github.com/Acefake/yingbox/releases/download/x/${name}`,
  ...extra,
})

const release = (
  tag: string,
  assets: unknown[],
  extra: Record<string, unknown> = {}
): Record<string, unknown> => ({
  tag_name: tag,
  prerelease: false,
  draft: false,
  body: '更新说明',
  published_at: '2026-11-03T10:00:00Z',
  assets,
  ...extra,
})

describe('桌面更新（pickDesktopUpdate）', () => {
  const list = [
    release('v1.0.2', [asset('yingbox-setup-1.0.2.exe')]),
    release('v1.0.3', [
      asset('yingbox-setup-1.0.3.exe'),
      asset('yingbox-android-1.0.3-arm64-v8a.apk'),
    ]),
    release('v1.0.4', [asset('yingbox-setup-1.0.4.exe')], { draft: true }),
    release('v1.0.5', [asset('yingbox-setup-1.0.5.exe')], { prerelease: true }),
  ]

  it('给出比当前新的最新一版，草稿和 Pre-release 不算', () => {
    expect(pickDesktopUpdate(list, '1.0.1')).toMatchObject({
      version: '1.0.3',
      name: 'yingbox-setup-1.0.3.exe',
      notes: '更新说明',
      size: 197_000_000,
      sha256: 'c'.repeat(64),
    })
  })

  it('已是最新或当前版本格式不对时没有更新', () => {
    expect(pickDesktopUpdate(list, '1.0.3')).toBeNull()
    expect(pickDesktopUpdate(list, 'dev')).toBeNull()
  })

  it('发布里没有安装包、没有摘要、不是 https、大小不对时跳过这一版', () => {
    const bad = (extra: Record<string, unknown>): unknown[] => [
      release('v1.0.9', [asset('yingbox-setup-1.0.9.exe', extra)]),
    ]
    expect(pickDesktopUpdate(bad({ digest: '' }), '1.0.1')).toBeNull()
    expect(
      pickDesktopUpdate(
        bad({ browser_download_url: 'http://x/a.exe' }),
        '1.0.1'
      )
    ).toBeNull()
    expect(pickDesktopUpdate(bad({ size: 0 }), '1.0.1')).toBeNull()
    expect(
      pickDesktopUpdate(
        [release('v1.0.9', [asset('yingbox-android-1.0.9-x86_64.apk')])],
        '1.0.1'
      )
    ).toBeNull()
  })

  it('外部数据乱七八糟也不抛错', () => {
    expect(pickDesktopUpdate('坏数据', '1.0.1')).toBeNull()
    expect(pickDesktopUpdate([null, 3, { tag_name: 5 }], '1.0.1')).toBeNull()
  })
})
