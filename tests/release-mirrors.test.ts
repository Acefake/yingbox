import { describe, expect, it } from 'vitest'

import {
  GITHUB_MIRROR_PREFIX,
  githubAssetCandidates,
  isGithubMirrorHost,
  mirrorCandidates,
  shouldTryNextMirror,
} from '../src/shared/release/mirrors'
import { BUILTIN_MIRRORS } from '../src/shared/network/preferences'

describe('release mirrors', () => {
  it('白名单主机：官方在前，随后按内置顺序改写完整 URL', () => {
    const api =
      'https://api.github.com/repos/Acefake/yingbox/releases?per_page=30'
    // GitHub API 只使用已验证支持该能力的 gh-proxy.com
    expect(mirrorCandidates(api)).toEqual([
      api,
      `${GITHUB_MIRROR_PREFIX}${api}`,
    ])
    const asset =
      'https://github.com/Acefake/yingbox/releases/download/v1.0.4/x.exe'
    expect(mirrorCandidates(asset)).toEqual([
      asset,
      ...BUILTIN_MIRRORS.map(prefix => `${prefix}${asset}`),
    ])
    expect(
      mirrorCandidates(
        'https://objects.githubusercontent.com/github-production-release-asset-2e65be/x'
      )
    ).toHaveLength(1 + BUILTIN_MIRRORS.length)
  })

  it('非白名单或不合法地址不套镜像', () => {
    expect(mirrorCandidates('https://example.com/a')).toEqual([
      'https://example.com/a',
    ])
    expect(mirrorCandidates('http://github.com/a')).toEqual([])
    expect(mirrorCandidates('not-a-url')).toEqual([])
  })

  it('安装包候选拒绝非 GitHub 主机', () => {
    expect(githubAssetCandidates('https://example.com/a.apk')).toEqual([])
    const asset =
      'https://github.com/Acefake/yingbox/releases/download/v1.0.4/x.exe'
    expect(githubAssetCandidates(asset)).toEqual([
      asset,
      ...BUILTIN_MIRRORS.map(prefix => `${prefix}${asset}`),
    ])
  })

  it('可重试判定：官方候选保持 ADR-0051 的边界', () => {
    expect(shouldTryNextMirror(null, new TypeError('fetch failed'))).toBe(true)
    expect(shouldTryNextMirror(429, null)).toBe(false)
    expect(shouldTryNextMirror(503, null)).toBe(true)
    expect(shouldTryNextMirror(404, null)).toBe(false)
    expect(shouldTryNextMirror(403, null)).toBe(false)
    expect(isGithubMirrorHost('api.github.com')).toBe(true)
    expect(isGithubMirrorHost('evil.com')).toBe(false)
  })

  it('镜像候选自身返回任何非 2xx 都换下一个（ADR-0055）', () => {
    // 镜像的 403 是它自己的配额耗尽，不代表请求方没有权限
    expect(shouldTryNextMirror(403, null, true)).toBe(true)
    expect(shouldTryNextMirror(404, null, true)).toBe(true)
    expect(shouldTryNextMirror(429, null, true)).toBe(true)
    expect(shouldTryNextMirror(503, null, true)).toBe(true)
    expect(shouldTryNextMirror(null, new TypeError('fetch failed'), true)).toBe(
      true
    )
  })
})
