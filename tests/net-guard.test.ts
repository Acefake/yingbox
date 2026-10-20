import { describe, expect, it } from 'vitest'
import { assertPublicTarget, isPrivateIPLiteral } from '../src/shared/net/guard'

describe('isPrivateIPLiteral', () => {
  it('flags loopback and private IPv4 ranges', () => {
    expect(isPrivateIPLiteral('127.0.0.1')).toBe(true)
    expect(isPrivateIPLiteral('10.1.2.3')).toBe(true)
    expect(isPrivateIPLiteral('172.16.0.1')).toBe(true)
    expect(isPrivateIPLiteral('192.168.1.1')).toBe(true)
    expect(isPrivateIPLiteral('169.254.1.1')).toBe(true)
    expect(isPrivateIPLiteral('100.64.0.1')).toBe(true)
  })

  it('allows public IPv4 addresses', () => {
    expect(isPrivateIPLiteral('8.8.8.8')).toBe(false)
    expect(isPrivateIPLiteral('1.1.1.1')).toBe(false)
    expect(isPrivateIPLiteral('172.32.0.1')).toBe(false)
  })

  it('handles IPv6 literals including mapped IPv4', () => {
    expect(isPrivateIPLiteral('::1')).toBe(true)
    expect(isPrivateIPLiteral('fe80::1')).toBe(true)
    expect(isPrivateIPLiteral('fc00::1')).toBe(true)
    expect(isPrivateIPLiteral('::ffff:192.168.1.1')).toBe(true)
    expect(isPrivateIPLiteral('::ffff:8.8.8.8')).toBe(false)
    expect(isPrivateIPLiteral('2001:4860:4860::8888')).toBe(false)
  })
})

describe('assertPublicTarget', () => {
  const publicDns = async () => [{ address: '93.184.216.34' }]
  const privateDns = async () => [
    { address: '93.184.216.34' },
    { address: '192.168.1.10' },
  ]

  it('公网域名放行', async () => {
    await expect(
      assertPublicTarget('https://example.com/a', publicDns)
    ).resolves.toBeInstanceOf(URL)
  })

  it('任一解析记录落在内网即拒绝（防恶意域名指向内网）', async () => {
    await expect(
      assertPublicTarget('https://evil.example/a', privateDns)
    ).rejects.toThrow('内网')
  })

  it('解析失败拒绝、非 http 协议拒绝、带账号密码拒绝、localhost 拒绝', async () => {
    const failing = async () => {
      throw new Error('ENOTFOUND')
    }
    await expect(
      assertPublicTarget('https://x.example', failing)
    ).rejects.toThrow('无法解析')
    await expect(
      assertPublicTarget('file:///etc/passwd', publicDns)
    ).rejects.toThrow('HTTP')
    await expect(
      assertPublicTarget('https://u:p@example.com', publicDns)
    ).rejects.toThrow('账号')
    await expect(
      assertPublicTarget('http://localhost:31471', publicDns)
    ).rejects.toThrow('内网')
  })
})
