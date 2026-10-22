/**
 * 对外监听的门槛：只听本机回环地址时不设限；改成 0.0.0.0 / 局域网 IP 等对外地址时，
 * 必须显式设置足够长、不是示例占位串的访问令牌（YINGBOX_SERVER_TOKEN），否则拒绝启动。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MIN_EXPOSED_TOKEN_LENGTH,
  exposureProblem,
  isLoopbackHost,
} from '../../src/server/exposure'

const strong = 'k3J9vQ2mX8pL5tR7wZ1nB4cD6fH0'

describe('回环地址判定', () => {
  it.each([
    '127.0.0.1',
    '127.1.2.3',
    '::1',
    '[::1]',
    'localhost',
    '::ffff:127.0.0.1',
  ])('%s 只本机可达', host => expect(isLoopbackHost(host)).toBe(true))

  it.each([
    '0.0.0.0',
    '::',
    '192.168.1.10',
    '10.0.0.2',
    'nas.local',
    '128.0.0.1',
    '::ffff:192.168.1.2',
  ])('%s 对外可达', host => expect(isLoopbackHost(host)).toBe(false))
})

describe('对外监听要求显式令牌', () => {
  it('回环地址不要求令牌（沿用首次启动生成的令牌）', () => {
    expect(exposureProblem('127.0.0.1', {})).toBeNull()
    expect(exposureProblem('::1', {})).toBeNull()
  })

  it('对外地址没有设置令牌：拒绝，并说明怎么改', () => {
    const problem = exposureProblem('0.0.0.0', {})
    expect(problem).toMatch(/YINGBOX_SERVER_TOKEN/)
    expect(problem).toMatch(/0\.0\.0\.0/)
    expect(
      exposureProblem('192.168.1.10', { YINGBOX_SERVER_TOKEN: '   ' })
    ).toMatch(/YINGBOX_SERVER_TOKEN/)
  })

  it(`令牌短于 ${MIN_EXPOSED_TOKEN_LENGTH} 个字符：拒绝`, () => {
    const short = 'a'.repeat(MIN_EXPOSED_TOKEN_LENGTH - 1)
    expect(exposureProblem('0.0.0.0', { YINGBOX_SERVER_TOKEN: short })).toMatch(
      new RegExp(`${MIN_EXPOSED_TOKEN_LENGTH}`)
    )
    const exact = 'a'.repeat(MIN_EXPOSED_TOKEN_LENGTH)
    expect(
      exposureProblem('0.0.0.0', { YINGBOX_SERVER_TOKEN: exact })
    ).toBeNull()
  })

  it('长度按去掉首尾空白后计算', () => {
    const padded = ` ${'a'.repeat(MIN_EXPOSED_TOKEN_LENGTH - 1)} `
    expect(
      exposureProblem('::', { YINGBOX_SERVER_TOKEN: padded })
    ).not.toBeNull()
  })

  it('照抄示例里的占位串：拒绝', () => {
    expect(
      exposureProblem('0.0.0.0', {
        YINGBOX_SERVER_TOKEN: 'change-me-to-a-long-random-string',
      })
    ).toMatch(/示例/)
    expect(
      exposureProblem('0.0.0.0', {
        YINGBOX_SERVER_TOKEN: 'CHANGE-ME-please-0123456789abcdef',
      })
    ).toMatch(/示例/)
  })

  it('足够长的随机令牌：放行', () => {
    expect(
      exposureProblem('0.0.0.0', { YINGBOX_SERVER_TOKEN: strong })
    ).toBeNull()
    expect(
      exposureProblem('nas.local', { YINGBOX_SERVER_TOKEN: strong })
    ).toBeNull()
  })
})

describe('服务入口', () => {
  /** 用 tsx 直接跑源码入口；门槛在打开数据库之前，被拒时不会建数据目录。 */
  const runEntry = (
    args: string[],
    env: Record<string, string>
  ): { status: number | null; stderr: string } => {
    const dataDir = mkdtempSync(join(tmpdir(), 'yingbox-exposure-'))
    try {
      const result = spawnSync(
        process.execPath,
        ['--import', 'tsx', 'src/server/index.ts', ...args],
        {
          encoding: 'utf8',
          timeout: 30_000,
          env: {
            PATH: process.env.PATH ?? '',
            YINGBOX_DATA_DIR: join(dataDir, 'data'),
            YINGBOX_WEB_DIR: 'off',
            ...env,
          },
        }
      )
      expect(existsSync(join(dataDir, 'data'))).toBe(false)
      return { status: result.status, stderr: result.stderr }
    } finally {
      rmSync(dataDir, { recursive: true, force: true })
    }
  }

  it('环境变量改成 0.0.0.0 而没有令牌：启动失败，退出码 1', () => {
    const { status, stderr } = runEntry([], { YINGBOX_HOST: '0.0.0.0' })
    expect(status).toBe(1)
    expect(stderr).toMatch(/YINGBOX_SERVER_TOKEN/)
  })

  it('命令行 --host 同样受限', () => {
    const { status, stderr } = runEntry(['--host', '0.0.0.0'], {
      YINGBOX_SERVER_TOKEN: 'short',
    })
    expect(status).toBe(1)
    expect(stderr).toMatch(new RegExp(`${MIN_EXPOSED_TOKEN_LENGTH}`))
  })
})
