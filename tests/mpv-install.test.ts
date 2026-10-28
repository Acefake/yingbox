import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  distribution,
  downloadMpvFile,
  mpvDistributionReady,
  mpvMemberPath,
  prepareMpvDistribution,
} from '../src/main/mpv-distribution'

const directories: string[] = []

async function workspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'yingbox-mpv-'))
  directories.push(dir)
  return dir
}

const digest = (value: string): string =>
  createHash('sha256').update(value).digest('hex')

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))
  )
})

describe('mpv 安装校验', () => {
  it('下载连接中断后自动重试并校验文件', async () => {
    const file = join(await workspace(), 'mpv.pkg.tar.zst')
    let calls = 0
    await downloadMpvFile(
      file,
      'https://example.invalid/mpv',
      digest('correct'),
      async () => {
        calls++
        if (calls === 1) throw new Error('连接中断')
        return new Response('correct')
      }
    )
    expect(calls).toBe(2)
    expect(await readFile(file, 'utf8')).toBe('correct')
  })

  it('损坏的下载不能提交到缓存，重试可成功，命中缓存不访问网络', async () => {
    const file = join(await workspace(), 'mpv.pkg.tar.zst')
    await expect(
      downloadMpvFile(
        file,
        'https://example.invalid/mpv',
        digest('correct'),
        async () => new Response('broken')
      )
    ).rejects.toThrow('校验失败')
    await expect(readFile(file)).rejects.toThrow()
    await expect(readFile(`${file}.part`)).rejects.toThrow()
    await downloadMpvFile(
      file,
      'https://example.invalid/mpv',
      digest('correct'),
      async () => new Response('correct')
    )
    await downloadMpvFile(
      file,
      'https://example.invalid/mpv',
      digest('correct'),
      async () => {
        throw new Error('不应请求网络')
      }
    )
    expect(await readFile(file, 'utf8')).toBe('correct')
  })

  it('下载失败保留已有安装和用户文件', async () => {
    const dest = await workspace()
    await writeFile(join(dest, 'mpv.conf'), 'keep')
    await expect(
      prepareMpvDistribution({
        dest,
        cache: join(dest, 'cache'),
        tar: 'unused',
        fetcher: async () => new Response(null, { status: 503 }),
      })
    ).rejects.toThrow('503')
    expect(await readFile(join(dest, 'mpv.conf'), 'utf8')).toBe('keep')
    await expect(readFile(`${dest}.part`)).rejects.toThrow()
  })

  it('仅有安装标记但缺失播放器时不可复用', async () => {
    const dest = await workspace()
    await writeFile(
      join(dest, 'distribution.json'),
      JSON.stringify({ id: distribution.id })
    )
    expect(await mpvDistributionReady(dest)).toBe(false)
  })

  it.each([
    '../mpv.exe',
    'ucrt64/../mpv.exe',
    'ucrt64/./mpv.exe',
    'ucrt64/bin\\mpv.exe',
    '/ucrt64/bin/mpv.exe',
  ])('拒绝包路径穿越 %s', member => {
    expect(() => mpvMemberPath(member)).toThrow('路径不合法')
  })
})
