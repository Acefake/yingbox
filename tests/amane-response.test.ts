import { describe, expect, it } from 'vitest'
import { readAmaneResponse } from '../src/main/plugins/amane/response'

describe('Amane API responses', () => {
  it('reports a plain-text server failure with its endpoint and HTTP status', async () => {
    await expect(readAmaneResponse(new Response('Internal Server Error', { status: 500 }), '/api/config/schema'))
      .rejects.toThrow('Amane 请求失败（HTTP 500，/api/config/schema）')
  })

  it('preserves JSON error details and validation messages', async () => {
    await expect(readAmaneResponse(Response.json({ detail: '无效配置' }, { status: 400 }), '/api/config'))
      .rejects.toThrow('无效配置')
    await expect(readAmaneResponse(Response.json({ detail: [{ msg: '必填字段' }] }, { status: 422 }), '/api/config'))
      .rejects.toThrow('必填字段')
  })

  it('handles JSON null errors and invalid successful responses', async () => {
    await expect(readAmaneResponse(Response.json(null, { status: 500 }), '/api/tasks'))
      .rejects.toThrow('HTTP 500')
    await expect(readAmaneResponse(new Response('<html>error</html>'), '/api/metadata'))
      .rejects.toThrow('Amane 返回了无效的 JSON（HTTP 200，/api/metadata）')
  })

  it('returns successful JSON and empty 204 responses', async () => {
    await expect(readAmaneResponse(Response.json({ items: [] }), '/api/metadata')).resolves.toEqual({ items: [] })
    await expect(readAmaneResponse(new Response(null, { status: 204 }), '/api/config')).resolves.toBeNull()
  })
})
