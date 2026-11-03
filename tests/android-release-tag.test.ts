import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ensureRemoteTag } from '../scripts/android/release-tag.mjs'

describe('安卓发布标签绑定源码', () => {
  let root: string
  let work: string
  let first: string
  let head: string
  const git = (args: string[]): string =>
    execFileSync('git', args, {
      cwd: work,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'yingbox-release-tag-'))
    work = root
    git(['init', '--bare', 'origin.git'])
    git(['init', 'work'])
    work = join(root, 'work')
    git(['remote', 'add', 'origin', join(root, 'origin.git')])
    git([
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '--allow-empty',
      '-m',
      'first',
    ])
    first = git(['rev-parse', 'HEAD'])
    git(['tag', 'android-v0.0.1'])
    git(['push', 'origin', 'HEAD:refs/heads/main', 'refs/tags/android-v0.0.1'])
    git([
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'commit',
      '--allow-empty',
      '-m',
      'second',
    ])
    head = git(['rev-parse', 'HEAD'])
  })
  afterAll(() => {
    if (root && resolve(root).startsWith(resolve(tmpdir()) + sep))
      rmSync(root, { recursive: true, force: true })
  })
  it('拒绝已有错误标签，不覆盖旧源码', () => {
    expect(() => ensureRemoteTag(work, 'android-v0.0.1', head)).toThrow(
      '远端标签'
    )
    expect(
      git(['ls-remote', 'origin', 'refs/tags/android-v0.0.1']).split(/\s+/)[0]
    ).toBe(first)
  })
  it('创建正确标签，重复执行保持同一指向', () => {
    ensureRemoteTag(work, 'android-v0.1.0', head)
    ensureRemoteTag(work, 'android-v0.1.0', head)
    expect(
      git(['ls-remote', 'origin', 'refs/tags/android-v0.1.0']).split(/\s+/)[0]
    ).toBe(head)
  })
  it('解引用带附注标签，不把 tag 对象当作提交', () => {
    git([
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      'tag',
      '-a',
      'android-v0.1.1',
      '-m',
      'annotation',
      head,
    ])
    git(['push', 'origin', 'refs/tags/android-v0.1.1'])
    expect(() => ensureRemoteTag(work, 'android-v0.1.1', head)).not.toThrow()
  })
  it('拒绝本地同名错误标签', () => {
    git(['tag', 'android-v0.2.0', first])
    expect(() => ensureRemoteTag(work, 'android-v0.2.0', head)).toThrow(
      '本地标签'
    )
  })
})
