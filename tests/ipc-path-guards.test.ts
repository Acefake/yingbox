/**
 * IPC 边界的本地路径校验：shell:openPath 只打开文件夹。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { openPathError } from '../src/main/ipc/path-guards'

let dir: string
beforeEach(() => (dir = mkdtempSync(join(tmpdir(), 'yingbox-guard-'))))
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('shell:openPath 的路径校验', () => {
  it('只接受已存在文件夹的绝对路径', async () => {
    expect(await openPathError(dir)).toBeNull()
    const exe = join(dir, 'setup.exe')
    writeFileSync(exe, 'MZ')
    expect(await openPathError(exe)).toBe('只能打开文件夹')
    expect(await openPathError(join(dir, 'missing'))).toBe('文件夹不存在')
    expect(await openPathError('relative/dir')).toBe('路径无效')
    expect(await openPathError('')).toBe('路径无效')
  })
})
