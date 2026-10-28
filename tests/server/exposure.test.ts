/**
 * 对外监听的检查：只听本机回环地址时不设限；改成 0.0.0.0 / 局域网 IP 等对外地址时，
 * 没设访问令牌照常启动并警告；设了访问令牌（YINGBOX_SERVER_TOKEN）则必须足够长、不是示例占位串，否则拒绝启动。
 */
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MIN_EXPOSED_TOKEN_LENGTH,
  exposureProblem,
  exposureWarning,
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

describe('对外监听：令牌可选，设了就要合格', () => {
  it('回环地址不检查、不警告', () => {
    expect(exposureProblem('127.0.0.1', {})).toBeNull()
    expect(exposureProblem('::1', {})).toBeNull()
    expect(exposureWarning('127.0.0.1', {})).toBeNull()
    expect(exposureWarning('localhost', {})).toBeNull()
  })

  it('对外地址没有设置令牌：放行，但给一行警告', () => {
    expect(exposureProblem('0.0.0.0', {})).toBeNull()
    expect(
      exposureProblem('192.168.1.10', { YINGBOX_SERVER_TOKEN: '   ' })
    ).toBeNull()
    const warning = exposureWarning('0.0.0.0', {})
    expect(warning).toMatch(/任何人/)
    expect(warning).toMatch(/YINGBOX_SERVER_TOKEN/)
    expect(
      exposureWarning('192.168.1.10', { YINGBOX_SERVER_TOKEN: '   ' })
    ).not.toBeNull()
  })

  it('设了令牌就不再警告', () => {
    expect(
      exposureWarning('0.0.0.0', { YINGBOX_SERVER_TOKEN: strong })
    ).toBeNull()
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

  it('环境变量改成 0.0.0.0、令牌太短：启动失败，退出码 1', () => {
    const { status, stderr } = runEntry([], {
      YINGBOX_HOST: '0.0.0.0',
      YINGBOX_SERVER_TOKEN: 'short',
    })
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

  it.each(['', strong])(
    '令牌为 %s：服务正常启动，日志不泄露令牌，无令牌时保留警告',
    async token => {
      const dir = mkdtempSync(join(tmpdir(), 'yingbox-open-'))
      writeFileSync(join(dir, 'index.html'), '<html>影盒</html>')
      const child = spawn(
        process.execPath,
        ['--import', 'tsx', 'src/server/index.ts', '--port', '0'],
        {
          env: {
            PATH: process.env.PATH ?? '',
            YINGBOX_HOST: '0.0.0.0',
            YINGBOX_SERVER_TOKEN: token,
            YINGBOX_DATA_DIR: join(dir, 'data'),
            YINGBOX_MEDIA_ROOTS: dir,
            YINGBOX_WEB_DIR: dir,
            YINGBOX_WATCH: 'off',
            YINGBOX_SCAN_INTERVAL: '0',
            YINGBOX_ONLINE: 'off',
          },
        }
      )
      let stdout = ''
      let stderr = ''
      const exited = once(child, 'close')
      child.stdout.on('data', chunk => (stdout += String(chunk)))
      child.stderr.on('data', chunk => (stderr += String(chunk)))
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error(`没等到启动日志：${stdout}${stderr}`)),
            45_000
          )
          const check = (): void => {
            if (/访问令牌：/.test(stdout) && (token || /警告/.test(stderr))) {
              clearTimeout(timer)
              resolve()
            }
          }
          child.stdout.on('data', check)
          child.stderr.on('data', check)
          child.once('exit', code => {
            clearTimeout(timer)
            reject(new Error(`服务提前退出（${code}）：${stderr}`))
          })
        })
        expect(stdout).toContain('网页端：http://')
        expect(stdout).not.toContain('?token=')
        if (token) {
          expect(stdout + stderr).not.toContain(token)
          expect(stdout).toContain('访问令牌：已开启')
        } else {
          expect(stdout).toMatch(/访问令牌：未设置，不鉴权/)
          expect(stderr).toMatch(/任何人都能访问/)
        }
      } finally {
        child.kill('SIGKILL')
        await exited
        rmSync(dir, { recursive: true, force: true })
      }
    },
    60_000
  )
})
