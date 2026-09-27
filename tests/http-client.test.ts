import { describe, expect, it } from 'vitest'
import { isPrivateIPLiteral } from '../src/main/http-client'

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
