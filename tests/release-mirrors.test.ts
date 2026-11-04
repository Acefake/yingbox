import { describe, expect, it } from 'vitest'

import {
  GITHUB_MIRROR_PREFIX,
  githubAssetCandidates,
  isGithubMirrorHost,
  mirrorCandidates,
  shouldTryNextMirror,
} from '../src/shared/release/mirrors'

describe('release mirrors', () => {
  it('白名单主机：官方在前，随后 gh-proxy 完整 URL 改写', () => {
    const api =
      'https://api.github.com/repos/Acefake/yingbox/releases?per_page=30'
    expect(mirrorCandidates(api)).toEqual([
      api,
      `${GITHUB_MIRROR_PREFIX}${api}`,
    ])
    const asset =
      'https://github.com/Acefake/yingbox/releases/download/v1.0.4/x.exe'
    expect(mirrorCandidates(asset)[1]).toBe(`${GITHUB_MIRROR_PREFIX}${asset}`)
    expect(
      mirrorCandidates(
        'https://objects.githubusercontent.com/github-production-release-asset-2e65be/x'
      )
    ).toHaveLength(2)
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
      `${GITHUB_MIRROR_PREFIX}${asset}`,
    ])
  })

  it('可重试判定', () => {
    expect(shouldTryNextMirror(null, new TypeError('fetch failed'))).toBe(true)
    expect(shouldTryNextMirror(429, null)).toBe(true)
    expect(shouldTryNextMirror(503, null)).toBe(true)
    expect(shouldTryNextMirror(404, null)).toBe(false)
    expect(shouldTryNextMirror(403, null)).toBe(false)
    expect(isGithubMirrorHost('api.github.com')).toBe(true)
    expect(isGithubMirrorHost('evil.com')).toBe(false)
  })
})
