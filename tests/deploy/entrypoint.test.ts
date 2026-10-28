/**
 * 容器入口 docker/entrypoint.sh：以 root 启动时把配置 / 缓存目录交给 PUID:PGID，再用 setpriv 降权执行服务；
 * 不以 root 启动（compose 里写了 user:）时原样执行；PUID / PGID 非数字或为 0 时拒绝启动。
 *
 * 用 PATH 里的替身代替 id / chown / setpriv（记录参数），目录与 find 都是真的：
 * 测试进程自己的 uid 当作“目录现有属主”，替身 chown 只记不改。
 */
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const ENTRYPOINT = resolve(__dirname, '../../docker/entrypoint.sh')
// Git Bash 的 POSIX uid/gid 与 Windows 的 os.userInfo()（-1）不同。
const me = {
  uid: spawnSync('sh', ['-c', 'id -u'], { encoding: 'utf8' }).stdout.trim(),
  gid: spawnSync('sh', ['-c', 'id -g'], { encoding: 'utf8' }).stdout.trim(),
}
const shellPath = (path: string): string => path.replace(/\\/g, '/')

let work: string
let bin: string
let calls: string

/** 写一个记录调用的替身命令。 */
function stub(name: string, body: string): void {
  const file = join(bin, name)
  writeFileSync(file, `#!/bin/sh\n${body}\n`)
  chmodSync(file, 0o755)
}

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'yingbox-entry-'))
  bin = join(work, 'bin')
  calls = join(work, 'calls.log')
  mkdirSync(bin)
  writeFileSync(calls, '')
  stub('id', 'echo "${FAKE_UID:-0}"')
  stub('chown', `echo "chown $*" >> "${shellPath(calls)}"`)
  stub('setpriv', `echo "setpriv $*" >> "${shellPath(calls)}"`)
  stub('serve', `echo "serve $*" >> "${shellPath(calls)}"`)
})

afterEach(() => rmSync(work, { recursive: true, force: true }))

function run(env: Record<string, string>): {
  status: number | null
  stderr: string
  calls: string[]
} {
  const result = spawnSync(
    'sh',
    [
      '-c',
      'bin=$(cd "$1" && pwd); export PATH="$bin:$PATH"; shift; exec sh "$@"',
      'entrypoint-test',
      shellPath(bin),
      shellPath(ENTRYPOINT),
      'serve',
      '--flag',
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        PUID: '',
        PGID: '',
        FAKE_UID: '0',
        YINGBOX_DATA_DIR: shellPath(join(work, 'config')),
        YINGBOX_CACHE_DIR: shellPath(join(work, 'cache')),
        YINGBOX_DOWNLOAD_DIR: shellPath(join(work, 'downloads')),
        ...env,
      },
    }
  )
  return {
    status: result.status,
    stderr: result.stderr,
    calls: readFileSync(calls, 'utf8').split('\n').filter(Boolean),
  }
}

describe('以 root 启动', () => {
  it('建好配置 / 缓存目录，属主不同的交给 PUID:PGID，再降权执行服务', () => {
    mkdirSync(join(work, 'config'))
    writeFileSync(join(work, 'config/library.db'), '')
    const { status, calls } = run({ PUID: '4242', PGID: '4343' })
    expect(status).toBe(0)
    const chowned = calls.filter(c => c.startsWith('chown'))
    // 不跟随符号链接（-h），配置目录里的文件与新建的缓存目录都在内
    expect(chowned.every(c => c.startsWith('chown -h 4242:4343 '))).toBe(true)
    const paths = chowned.flatMap(c => c.split(' ').slice(3))
    expect(paths).toEqual(
      expect.arrayContaining([
        shellPath(join(work, 'config')),
        shellPath(join(work, 'config/library.db')),
        shellPath(join(work, 'cache')),
      ])
    )
    expect(calls.at(-1)).toBe(
      'setpriv --reuid=4242 --regid=4343 --clear-groups -- serve --flag'
    )
  })

  it('属主已经对的不再 chown（重启不重复遍历改权限）', () => {
    const { status, calls } = run({
      PUID: String(me.uid),
      PGID: String(me.gid),
    })
    expect(status).toBe(0)
    expect(calls.filter(c => c.startsWith('chown'))).toEqual([])
    expect(calls.at(-1)).toBe(
      `setpriv --reuid=${me.uid} --regid=${me.gid} --clear-groups -- serve --flag`
    )
  })

  it('不设 PUID / PGID 时用镜像里 node 用户的 1000:1000', () => {
    const { calls } = run({})
    expect(calls.at(-1)).toBe(
      'setpriv --reuid=1000 --regid=1000 --clear-groups -- serve --flag'
    )
  })

  it.each([
    [{ PUID: '0' }, /root/],
    [{ PGID: '0' }, /root/],
    [{ PUID: 'abc' }, /数字/],
    [{ PGID: '10 00' }, /数字/],
    [{ PUID: '-5' }, /数字/],
  ])('%o：拒绝启动，不执行服务', (env, message) => {
    const { status, stderr, calls } = run(env)
    expect(status).not.toBe(0)
    expect(stderr).toMatch(message)
    expect(calls).toEqual([])
  })
})

describe('不以 root 启动（compose 的 user: 或 --user）', () => {
  it('不改属主、不调用 setpriv，原样执行服务', () => {
    const { status, calls } = run({ FAKE_UID: '1000', PUID: '4242' })
    expect(status).toBe(0)
    expect(calls).toEqual(['serve --flag'])
  })
})
