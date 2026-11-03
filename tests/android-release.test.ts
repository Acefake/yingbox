import { describe, expect, it, vi } from 'vitest'

import {
  createUpdateChecker,
  githubReleases,
} from '../src/server/view/app-update'
import {
  compareVersions,
  parseVersion,
  pickAndroidUpdate,
} from '../src/shared/android/release'

const asset = (
  name: string,
  extra: Record<string, unknown> = {}
): Record<string, unknown> => ({
  name,
  size: 1000,
  digest: `sha256:${'b'.repeat(64)}`,
  browser_download_url: `https://github.com/Acefake/yingbox/releases/download/x/${name}`,
  ...extra,
})

const release = (
  tag: string,
  assets: unknown[],
  extra: Record<string, unknown> = {}
): Record<string, unknown> => ({
  tag_name: tag,
  prerelease: true,
  draft: false,
  body: '更新说明',
  published_at: '2026-11-03T10:00:00Z',
  assets,
  ...extra,
})

describe('版本比较', () => {
  it('按 x.y.z 数值比较，不是字符串', () => {
    expect(parseVersion('0.10.2')).toEqual([0, 10, 2])
    expect(parseVersion('v1.0.0')).toBeNull()
    expect(parseVersion('1.0')).toBeNull()
    expect(compareVersions([0, 10, 0], [0, 9, 9])).toBeGreaterThan(0)
    expect(compareVersions([1, 0, 0], [1, 0, 0])).toBe(0)
  })
})

describe('从发布列表里挑更新（pickAndroidUpdate）', () => {
  const list = [
    release('v1.0.1', [asset('yingbox-1.0.1-setup.exe')], {
      prerelease: false,
    }),
    release('nas-v1.0.1-nas.1', []),
    release('android-v0.1.0', [asset('yingbox-android-0.1.0-arm64-v8a.apk')]),
    release('android-v0.2.0', [
      asset('yingbox-android-0.2.0-arm64-v8a.apk', {
        digest: `sha256:${'a'.repeat(64)}`,
        size: 5555,
      }),
      asset('yingbox-android-0.2.0-x86_64.apk'),
    ]),
    release('android-v0.3.0', [asset('yingbox-android-0.3.0-arm64-v8a.apk')], {
      draft: true,
    }),
  ]

  it('只认 android-v 标签，草稿不算；给出比当前新的最新一版和该 ABI 的包', () => {
    const update = pickAndroidUpdate(list, '0.1.0', ['arm64-v8a'])
    expect(update).toMatchObject({
      version: '0.2.0',
      notes: '更新说明',
      size: 5555,
      sha256: 'a'.repeat(64),
    })
    expect(update?.url).toContain('yingbox-android-0.2.0-arm64-v8a.apk')
  })

  it('按设备 ABI 的优先顺序选包', () => {
    const update = pickAndroidUpdate(list, '0.1.0', ['x86_64', 'arm64-v8a'])
    expect(update?.url).toContain('x86_64.apk')
  })

  it('已是最新、没有适合该设备的包、当前版本格式不对时都没有更新', () => {
    expect(pickAndroidUpdate(list, '0.2.0', ['arm64-v8a'])).toBeNull()
    expect(pickAndroidUpdate(list, '0.1.0', ['armeabi-v7a'])).toBeNull()
    expect(pickAndroidUpdate(list, 'abc', ['arm64-v8a'])).toBeNull()
  })

  it('外部数据乱七八糟也不抛错；下载地址必须是 https', () => {
    expect(pickAndroidUpdate('坏数据', '0.1.0', ['arm64-v8a'])).toBeNull()
    expect(
      pickAndroidUpdate([null, 3, { tag_name: 5 }], '0.1.0', ['arm64-v8a'])
    ).toBeNull()
    const insecure = [
      release('android-v0.2.0', [
        asset('yingbox-android-0.2.0-arm64-v8a.apk', {
          browser_download_url: 'http://x/a.apk',
        }),
      ]),
    ]
    expect(pickAndroidUpdate(insecure, '0.1.0', ['arm64-v8a'])).toBeNull()
  })

  it('发布里没给 digest 时不提供无法校验的包', () => {
    const update = pickAndroidUpdate(
      [
        release('android-v0.2.0', [
          asset('yingbox-android-0.2.0-arm64-v8a.apk', { digest: '' }),
        ]),
      ],
      '0.1.0',
      ['arm64-v8a']
    )
    expect(update).toBeNull()
  })

  it('拒绝标签与 APK 版本不一致、错误大小和无效校验值', () => {
    for (const invalid of [
      asset('yingbox-android-0.1.0-arm64-v8a.apk'),
      asset('yingbox-android-0.2.0-arm64-v8a.apk', { size: -1 }),
      asset('yingbox-android-0.2.0-arm64-v8a.apk', { size: 1.5 }),
      asset('yingbox-android-0.2.0-arm64-v8a.apk', { digest: 'sha256:bad' }),
    ]) {
      expect(
        pickAndroidUpdate([release('android-v0.2.0', [invalid])], '0.1.0', [
          'arm64-v8a',
        ])
      ).toBeNull()
    }
    expect(parseVersion('0.1.100')).toBeNull()
    expect(parseVersion('0.100.0')).toBeNull()
    expect(parseVersion('99999999999999999999.0.0')).toBeNull()
  })
})

describe('检查更新带缓存', () => {
  it('读取后续分页的安卓发布，并拒绝跳到其他地址的分页', async () => {
    const url =
      'https://api.github.com/repos/Acefake/yingbox/releases?per_page=100'
    const fetch = vi.spyOn(globalThis, 'fetch')
    fetch
      .mockResolvedValueOnce(
        new Response('[]', { headers: { link: `<${url}&page=2>; rel="next"` } })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            release('android-v0.2.0', [
              asset('yingbox-android-0.2.0-arm64-v8a.apk'),
            ]),
          ])
        )
      )
    try {
      expect(
        pickAndroidUpdate(await githubReleases(url)(), '0.1.0', ['arm64-v8a'])
          ?.version
      ).toBe('0.2.0')
      expect(fetch).toHaveBeenCalledTimes(2)
      fetch.mockResolvedValueOnce(
        new Response('[]', {
          headers: {
            link: '<https://other.invalid/releases?page=2>; rel="next"',
          },
        })
      )
      await expect(githubReleases(url)()).rejects.toThrow('更新分页地址不匹配')
    } finally {
      fetch.mockRestore()
    }
  })
  it('发布接口返回非数组时报告检查失败，不误报已是最新', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}'))
    try {
      await expect(githubReleases()()).rejects.toThrow('更新发布列表格式错误')
    } finally {
      fetch.mockRestore()
    }
  })
  it('并发查询复用请求，失败不污染缓存并允许重试', async () => {
    const fetchReleases = vi.fn(async (): Promise<unknown> => {
      throw new Error('offline')
    })
    const check = createUpdateChecker(fetchReleases)
    await Promise.all([
      expect(check('0.1.0', ['arm64-v8a'])).rejects.toThrow('offline'),
      expect(check('0.1.0', ['arm64-v8a'])).rejects.toThrow('offline'),
    ])
    expect(fetchReleases).toHaveBeenCalledTimes(1)
    fetchReleases.mockResolvedValue([])
    expect(await check('0.1.0', ['arm64-v8a'])).toBeNull()
    expect(fetchReleases).toHaveBeenCalledTimes(2)
  })
  it('10 分钟内不重复请求发布列表', async () => {
    let now = 0
    const fetchReleases = vi.fn(
      async (): Promise<unknown> => [
        release('android-v0.2.0', [
          asset('yingbox-android-0.2.0-arm64-v8a.apk'),
        ]),
      ]
    )
    const check = createUpdateChecker(fetchReleases, () => now)
    expect((await check('0.1.0', ['arm64-v8a']))?.version).toBe('0.2.0')
    now = 9 * 60 * 1000
    await check('0.1.0', ['arm64-v8a'])
    expect(fetchReleases).toHaveBeenCalledTimes(1)
    now = 11 * 60 * 1000
    await check('0.1.0', ['arm64-v8a'])
    expect(fetchReleases).toHaveBeenCalledTimes(2)
  })
})
