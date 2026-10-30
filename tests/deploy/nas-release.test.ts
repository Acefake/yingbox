import { describe, expect, it } from 'vitest'
import {
  requireNasPlatforms,
  validateReleaseVersion,
} from '../../scripts/nas-release.mjs'

describe('NAS 稳定版发布边界', () => {
  it('只接受明确的 NAS 正式版本', () => {
    expect(validateReleaseVersion('1.0.0-nas.1')).toBe('1.0.0-nas.1')
    for (const version of [
      'stable',
      'latest',
      '1.0.0',
      '../x',
      '-t',
      '1.0.0-nas.1;echo',
    ]) {
      expect(() => validateReleaseVersion(version)).toThrow('NAS 版本号')
    }
  })

  const platform = (
    architecture: string,
    digest = `sha256:${'a'.repeat(64)}`
  ): { digest: string; platform: { os: string; architecture: string } } => ({
    digest,
    platform: { os: 'linux', architecture },
  })

  it('接受含双架构和证明材料的索引', () => {
    const manifests = [
      platform('amd64'),
      platform('arm64'),
      { platform: { os: 'unknown' } },
    ]
    expect(requireNasPlatforms({ manifests })).toEqual(manifests.slice(0, 2))
  })

  it('拒绝单架构或缺失索引，避免把 NAS 切到不能运行的镜像', () => {
    for (const index of [{}, null, { manifests: [platform('amd64')] }]) {
      expect(() => requireNasPlatforms(index)).toThrow()
    }
  })

  it('拒绝重复架构与无效的内容摘要', () => {
    expect(() =>
      requireNasPlatforms({
        manifests: [platform('amd64'), platform('amd64'), platform('arm64')],
      })
    ).toThrow()
    expect(() =>
      requireNasPlatforms({
        manifests: [platform('amd64'), platform('arm64', 'not-a-digest')],
      })
    ).toThrow()
  })
})
