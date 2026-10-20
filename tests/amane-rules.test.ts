import { describe, expect, it } from 'vitest'
import { join, resolve } from 'node:path'
import {
  MAX_RESTART_ATTEMPTS,
  RESTART_EXHAUSTED,
  applyConfigure,
  errorDetail,
  executableProblem,
  isAguiPath,
  isImageResourcePath,
  mediaPathFor,
  normalizeBaseUrl,
  parseSavedSettings,
  permittedPath,
  requestTimeoutFor,
  restartPlan,
  serviceEnv,
  sourceEnv,
} from '../src/main/plugins/amane/rules'

const base = 'http://127.0.0.1:18180'
const abs = resolve('/amane-data')
const settings = {
  mode: 'managed' as const,
  executablePath: '',
  baseUrl: base,
  dataDirectory: abs,
}

describe('Amane 服务地址', () => {
  it('只接受本机 HTTP 根地址并规范成 origin', () => {
    expect(normalizeBaseUrl('http://127.0.0.1:18180/')).toBe(base)
    expect(normalizeBaseUrl('http://localhost:9000')).toBe(
      'http://localhost:9000'
    )
    expect(normalizeBaseUrl('http://[::1]:1')).toBe('http://[::1]:1')
  })
  it.each([
    'https://127.0.0.1:18180',
    'http://192.168.1.2:18180',
    'http://user:pw@127.0.0.1:1',
    'http://127.0.0.1:1/?a=1',
    'http://127.0.0.1:1/#x',
    'http://127.0.0.1:1/api',
  ])('拒绝 %s', raw => {
    expect(() => normalizeBaseUrl(raw)).toThrow('本机 HTTP')
  })
})

describe('Amane 已保存设置', () => {
  it('规范化地址并带出旧版密文令牌', () => {
    const parsed = parseSavedSettings({
      ...settings,
      baseUrl: `${base}/`,
      encryptedToken: 'abc',
    })
    expect(parsed).toEqual({ settings, encryptedToken: 'abc' })
  })
  it('没有密文令牌时不带该字段，且不保留多余字段', () => {
    expect(parseSavedSettings({ ...settings, extra: 1 })).toEqual({ settings })
  })
  it.each([
    null,
    { ...settings, mode: 'other' },
    { ...settings, executablePath: 1 },
    { ...settings, dataDirectory: 'relative/dir' },
    { ...settings, encryptedToken: 5 },
  ])('格式不对就抛错 %#', raw => {
    expect(() => parseSavedSettings(raw)).toThrow('无效的 Amane 连接设置')
  })
})

describe('Amane 连接设置修改', () => {
  it('合并改动：路径去空白、目录取绝对、令牌去空白', () => {
    const result = applyConfigure(settings, {
      mode: 'external',
      executablePath: '  /a/Amane.Server ',
      dataDirectory: join(abs, 'x', '..', 'y'),
      token: ' t0k ',
    })
    expect(result).toEqual({
      next: {
        ...settings,
        mode: 'external',
        executablePath: '/a/Amane.Server',
        dataDirectory: join(abs, 'y'),
      },
      token: 't0k',
    })
    expect(settings.mode).toBe('managed')
  })
  it('没改令牌时不返回 token；清空令牌返回空串', () => {
    expect(applyConfigure(settings, {})).toEqual({ next: settings })
    expect(applyConfigure(settings, { token: '' }).token).toBe('')
  })
  it('拒绝非法模式、相对目录、带换行或超长令牌', () => {
    expect(() => applyConfigure(settings, { mode: 'x' as never })).toThrow(
      '无效的服务模式'
    )
    expect(() => applyConfigure(settings, { dataDirectory: 'rel' })).toThrow(
      '绝对路径'
    )
    expect(() => applyConfigure(settings, { token: 'a\nb' })).toThrow(
      '无效的 API Token'
    )
    expect(() => applyConfigure(settings, { token: 'a'.repeat(4097) })).toThrow(
      '无效的 API Token'
    )
    expect(() =>
      applyConfigure(settings, { baseUrl: 'http://example.com' })
    ).toThrow('本机 HTTP')
  })
})

describe('Amane 请求白名单', () => {
  it('放行白名单内的方法与路径，保留查询串', () => {
    expect(
      permittedPath({ path: '/api/metadata?offset=0&limit=36' }, base)
    ).toBe('/api/metadata?offset=0&limit=36')
    expect(
      permittedPath({ path: '/api/tasks/worker/pause', method: 'POST' }, base)
    ).toBe('/api/tasks/worker/pause')
    expect(
      permittedPath({ path: '/api/agent/sessions/3', method: 'DELETE' }, base)
    ).toBe('/api/agent/sessions/3')
    expect(permittedPath({ path: '/api/config', method: 'PATCH' }, base)).toBe(
      '/api/config'
    )
  })
  it('拒绝不在白名单的方法 / 路径', () => {
    expect(() =>
      permittedPath({ path: '/api/metadata', method: 'DELETE' }, base)
    ).toThrow('不支持的 Amane 操作')
    expect(() =>
      permittedPath({ path: '/api/libraries/1', method: 'POST' }, base)
    ).toThrow('不支持的 Amane 操作')
    expect(() => permittedPath({ path: '/api/unknown' }, base)).toThrow(
      '不支持的 Amane 操作'
    )
  })
  it('拒绝非 /api/、反斜杠、换行、井号与超长路径', () => {
    for (const path of [
      '/x',
      '/api/a\\b',
      '/api/a\nb',
      '/api/health#x',
      `/api/${'a'.repeat(4096)}`,
    ])
      expect(() => permittedPath({ path }, base)).toThrow('无效的 Amane 请求')
  })
  it('拒绝借路径跳到别的主机', () => {
    expect(() =>
      permittedPath({ path: '/api/../../evil.com/api/health' }, base)
    ).toThrow('不支持的 Amane 操作')
  })
})

describe('Amane 转发细节', () => {
  it('网络检测放宽超时', () => {
    expect(requestTimeoutFor('/api/network/check')).toBe(120000)
    expect(requestTimeoutFor('/api/health')).toBe(30000)
  })
  it('只把回合订阅接口当作 agui', () => {
    expect(isAguiPath('/api/agent/sessions/12/agui')).toBe(true)
    expect(isAguiPath('/api/agent/sessions/12/agui/cancel')).toBe(false)
  })
  it('图片协议只放行资源路径', () => {
    expect(isImageResourcePath('/api/resources/0123456789abcdef')).toBe(true)
    expect(isImageResourcePath('/api/resources/proxy?url=x')).toBe(true)
    expect(isImageResourcePath('/api/resources/0123')).toBe(false)
    expect(isImageResourcePath('/api/metadata')).toBe(false)
  })
  it('detail 字符串原样、校验错误数组用分号连接', () => {
    expect(errorDetail('坏了')).toBe('坏了')
    expect(errorDetail([{ msg: 'a' }, { x: 1 }, { msg: 'b' }])).toBe('a；b')
    expect(errorDetail({})).toBe('')
  })
  it('相对媒体路径相对媒体库解析', () => {
    expect(mediaPathFor('a/b.mp4', abs)).toBe(join(abs, 'a', 'b.mp4'))
    expect(mediaPathFor(join(abs, 'c.mp4'), '/other')).toBe(join(abs, 'c.mp4'))
  })
})

describe('Amane 后台程序校验', () => {
  const exists = (): boolean => true
  it('只认 Amane.Server(.exe)', () => {
    expect(executableProblem(join(abs, 'Amane.Server.exe'), exists)).toBeNull()
    expect(executableProblem(join(abs, 'amane.server'), exists)).toBeNull()
    expect(executableProblem(join(abs, 'Amane.exe'), exists)).toContain(
      '托盘程序'
    )
  })
  it('空路径、相对路径、不存在都提示选择', () => {
    expect(executableProblem('', exists)).toContain('未找到')
    expect(executableProblem('Amane.Server', exists)).toContain('未找到')
    expect(executableProblem(join(abs, 'Amane.Server'), () => false)).toContain(
      '未找到'
    )
  })
})

describe('Amane 自动重启', () => {
  it('退避 4 秒递增、封顶 60 秒，提示带次数', () => {
    expect(restartPlan(0)).toEqual({
      attempt: 1,
      delay: 4000,
      message: expect.stringContaining('4 秒后自动重启（第 1/5 次）'),
    })
    expect(restartPlan(3)?.delay).toBe(16000)
  })
  it('用尽次数返回 null', () => {
    expect(restartPlan(MAX_RESTART_ATTEMPTS - 1)).not.toBeNull()
    expect(restartPlan(MAX_RESTART_ATTEMPTS)).toBeNull()
    expect(RESTART_EXHAUSTED).toContain(`${MAX_RESTART_ATTEMPTS} 次`)
  })
})

describe('Amane 启动环境', () => {
  it('从服务地址取主机端口，IPv6 去方括号，默认 80', () => {
    const env = serviceEnv(settings, 'tok', { KEEP: '1' })
    expect(env).toMatchObject({
      KEEP: '1',
      AMANE_HOST: '127.0.0.1',
      AMANE_PORT: '18180',
      AMANE_DATA_DIR: abs,
      AMANE_LOG_DIR: join(abs, 'logs'),
      AMANE_TOKEN: 'tok',
      AMANE_SUPERVISED: '1',
      AMANE_UI_DISABLED: '1',
    })
    const v6 = serviceEnv({ ...settings, baseUrl: 'http://[::1]' }, '', {})
    expect([v6.AMANE_HOST, v6.AMANE_PORT]).toEqual(['::1', '80'])
  })
  it('源码运行把 src 放到 PYTHONPATH 最前', () => {
    const env = sourceEnv({ A: '1' }, abs, undefined)
    expect(env).toMatchObject({
      A: '1',
      PYTHONUTF8: '1',
      PYTHONPATH: join(abs, 'src'),
    })
    expect(sourceEnv({}, abs, 'old').PYTHONPATH?.endsWith('old')).toBe(true)
  })
})
