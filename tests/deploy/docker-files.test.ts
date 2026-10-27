/**
 * Docker 部署文件的约定（Dockerfile / docker-compose.yml / .dockerignore），对应 ADR-0010：
 * - 基础镜像写死完整版本号 + 摘要，多阶段：构建工具（pnpm）不进运行镜像；
 * - 镜像不改监听地址（服务默认 127.0.0.1），入口脚本降权、自带健康检查；数据卷 /config、/cache；
 * - compose 示例默认只把端口映射到宿主 127.0.0.1，令牌可选（留空不鉴权），片库只读挂载；
 * - .dockerignore 挡住 .git、依赖、构建产物与 .env，又不挡构建要用的文件。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const dockerfile = readFileSync('Dockerfile', 'utf8')
const compose = readFileSync('docker-compose.yml', 'utf8')
const dockerignore = readFileSync('.dockerignore', 'utf8')
  .split('\n')
  .map(line => line.trim())
  .filter(line => line && !line.startsWith('#'))

/** Dockerfile 的指令（去掉注释、拼上续行）。 */
const instructions = dockerfile
  .replace(/\\\n/g, ' ')
  .split('\n')
  .map(line => line.trim())
  .filter(line => line && !line.startsWith('#'))

/** 按 FROM 切成阶段。 */
const stages = instructions.reduce<string[][]>((all, line) => {
  if (/^FROM\s/i.test(line)) all.push([line])
  else all.at(-1)?.push(line)
  return all
}, [])
const runtime = stages.at(-1) ?? []
const stageNames = stages.map(s => /\sAS\s+(\S+)/i.exec(s[0])?.[1])

describe('Dockerfile', () => {
  it('多阶段：至少一个构建阶段 + 运行阶段', () => {
    expect(stages.length).toBeGreaterThanOrEqual(2)
  })

  it('基础镜像写死完整版本号与摘要，各阶段同一个', () => {
    const bases = stages
      .map(s => s[0].split(/\s+/)[1])
      .filter(image => !stageNames.includes(image))
    expect(bases.length).toBeGreaterThan(0)
    for (const image of bases)
      expect(image).toMatch(
        /^node:\d+\.\d+\.\d+-[a-z]+-slim@sha256:[0-9a-f]{64}$/
      )
    expect(new Set(bases).size).toBe(1)
  })

  it('运行阶段从基础镜像起，不带 pnpm / corepack，也不装依赖', () => {
    expect(stageNames).not.toContain(runtime[0].split(/\s+/)[1])
    for (const line of runtime) expect(line).not.toMatch(/pnpm|corepack|npm /)
  })

  it('不在镜像里改监听地址（默认只听 127.0.0.1，对外要显式设置）', () => {
    expect(instructions.join('\n')).not.toMatch(/YINGBOX_HOST/)
  })

  it('入口脚本降权、健康检查、配置 / 缓存卷', () => {
    expect(runtime).toContainEqual(
      expect.stringMatching(
        /^ENTRYPOINT \["sh", "\/app\/docker\/entrypoint\.sh"\]$/
      )
    )
    expect(runtime).toContainEqual(
      expect.stringMatching(
        /^HEALTHCHECK .*CMD \["node", "\/app\/docker\/healthcheck\.mjs"\]$/
      )
    )
    expect(runtime).toContainEqual(
      expect.stringMatching(/^VOLUME \["\/config", "\/cache"\]$/)
    )
    expect(dockerfile).toMatch(/YINGBOX_DATA_DIR=\/config/)
    expect(dockerfile).toMatch(/YINGBOX_CACHE_DIR=\/cache/)
  })
})

describe('docker-compose.yml', () => {
  const ports = [...compose.matchAll(/^\s+-\s*'([^']*:\d+)'\s*(?:#.*)?$/gm)]
    .map(m => m[1])
    .filter(p => /^[\d.]*:?\d+:\d+$/.test(p))
  const volumes = [
    ...compose.matchAll(/^\s+-\s*'?([^'\s#]+:\/[^'\s#]*)'?\s*(?:#.*)?$/gm),
  ].map(m => m[1])

  it('端口默认只映射到宿主 127.0.0.1', () => {
    expect(ports.length).toBeGreaterThan(0)
    for (const port of ports) expect(port).toMatch(/^127\.0\.0\.1:/)
  })

  it('访问令牌可选（.env 没设时为空串，服务不鉴权）', () => {
    expect(compose).toMatch(
      /YINGBOX_SERVER_TOKEN: '\$\{YINGBOX_SERVER_TOKEN:-\}'/
    )
    expect(compose).not.toMatch(/YINGBOX_SERVER_TOKEN:\?/)
  })

  it('PUID / PGID 可配', () => {
    expect(compose).toMatch(/^\s+PUID: /m)
    expect(compose).toMatch(/^\s+PGID: /m)
  })

  it('相对路径的数据目录（含数据库与密钥）不进 git，也不进构建上下文', () => {
    const local = volumes
      .map(v => v.split(':')[0])
      .filter(source => source.startsWith('./'))
    expect(local.length).toBeGreaterThan(0)
    const gitignore = readFileSync('.gitignore', 'utf8').split('\n')
    for (const source of local) {
      const top = source.slice(2).split('/')[0]
      expect(dockerignore).toContain(top)
      expect(gitignore).toContain(`/${top}/`)
    }
  })

  it('配置、缓存两个卷；片库挂在 /media 下且只读', () => {
    expect(volumes.some(v => v.endsWith(':/config'))).toBe(true)
    expect(volumes.some(v => v.endsWith(':/cache'))).toBe(true)
    const media = volumes.filter(v => /:\/media(\/|:|$)/.test(v))
    expect(media.length).toBeGreaterThan(0)
    for (const v of media) expect(v).toMatch(/:ro$/)
  })
})

describe('.dockerignore', () => {
  it('挡住 .git、依赖、构建产物、本地密钥', () => {
    for (const entry of ['.git', 'node_modules', 'out', 'dist-web', '.env'])
      expect(dockerignore).toContain(entry)
  })

  it('不挡构建要用的文件', () => {
    for (const needed of [
      'package.json',
      'pnpm-lock.yaml',
      '.npmrc',
      'docker',
      'src',
      'vite.config.server.ts',
      'vite.config.web.ts',
    ])
      expect(
        dockerignore.filter(
          rule => !rule.startsWith('!') && (rule === needed || rule === '*')
        )
      ).toEqual([])
  })
})
