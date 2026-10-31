import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  localUrlToFilePath,
  parseRange,
  serveFile,
} from '../src/main/local-media'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    chmodSync(dir, 0o755)
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('parseRange', () => {
  it('parses explicit byte ranges', () => {
    expect(parseRange('bytes=0-499', 1000)).toEqual({ start: 0, end: 499 })
  })

  it('parses open-ended ranges', () => {
    expect(parseRange('bytes=500-', 1000)).toEqual({ start: 500, end: 999 })
  })

  it('parses suffix ranges', () => {
    expect(parseRange('bytes=-500', 1000)).toEqual({ start: 500, end: 999 })
  })

  it('clamps the end to size - 1', () => {
    expect(parseRange('bytes=0-5000', 1000)).toEqual({ start: 0, end: 999 })
  })

  it('rejects malformed or unsatisfiable ranges', () => {
    expect(parseRange('items=0-1', 1000)).toBeNull()
    expect(parseRange('bytes=-', 1000)).toBeNull()
    expect(parseRange('bytes=1000-', 1000)).toBeNull()
    expect(parseRange('bytes=0-1', 0)).toBeNull()
    expect(parseRange('bytes=500-100', 1000)).toBeNull()
  })
})

describe('localUrlToFilePath', () => {
  it('maps a windows drive host back to a path', () => {
    expect(localUrlToFilePath('local://f/Movies/a.mp4')).toBe('F:/Movies/a.mp4')
  })

  it('decodes percent-encoded path segments', () => {
    expect(localUrlToFilePath('local://f/Movies/%E4%BD%A0%E5%A5%BD.mp4')).toBe(
      'F:/Movies/你好.mp4'
    )
  })

  it('maps a posix absolute path', () => {
    expect(localUrlToFilePath('local:///home/u/a.mp4')).toBe('/home/u/a.mp4')
  })

  it('rejects non-drive hosts and invalid URLs', () => {
    expect(localUrlToFilePath('local://evil.example/a.mp4')).toBeNull()
    expect(localUrlToFilePath('not a url')).toBeNull()
  })
})

describe('serveFile', () => {
  it('按扩展名给出 MPEG-TS 的类型', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'yingbox-media-'))
    dirs.push(dir)
    const file = join(dir, 'clip.ts')
    writeFileSync(file, Buffer.from('ts'))
    const res = await serveFile(file, new Request('http://nas/clip.ts'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('video/mp2t')
  })

  it('没有读权限时回 403 并记下路径和错误码', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'yingbox-media-'))
    dirs.push(dir)
    const file = join(dir, 'clip.mkv')
    writeFileSync(file, Buffer.alloc(16, 1))
    chmodSync(file, 0)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const res = await serveFile(file, new Request('http://nas/clip.mkv'))
      expect(res.status).toBe(403)
      expect(String(warn.mock.calls[0]?.[0])).toContain(file)
      expect(String(warn.mock.calls[0]?.[0])).toContain('EACCES')
    } finally {
      warn.mockRestore()
      chmodSync(file, 0o644)
    }
  })
})
