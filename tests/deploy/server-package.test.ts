/** 独立包必须包含完整工作进程、运行依赖与可选网页，搬离仓库后可安装。 */
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { stageServerPackage } from '../../scripts/package-server.mjs'
import { serverRuntimeManifest } from '../../scripts/server-runtime-package'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map(root => rm(root, { recursive: true, force: true }))
  )
})

describe('独立服务运行依赖', () => {
  const pkg = {
    version: '1.0.1',
    license: 'MIT',
    homepage: 'https://example.com',
    dependencies: {
      '@jsquash/webp': '^1.5.0',
      cheerio: '^1.2.0',
      'onnxruntime-node': '1.23.2',
      electron: '45.1.0',
    },
  }
  it('保留包子路径、锁定安装版本、将原生推理运行时设为可选', () => {
    const result = serverRuntimeManifest(
      [
        'node:fs',
        'path',
        '@jsquash/webp/encode.js',
        '@jsquash/webp/decode.js',
        'cheerio',
        'onnxruntime-node',
      ],
      pkg,
      name =>
        ({
          '@jsquash/webp': '1.5.0',
          cheerio: '1.2.0',
          'onnxruntime-node': '1.23.2',
        })[name]!
    )
    expect(result.dependencies).toEqual({
      '@jsquash/webp': '1.5.0',
      cheerio: '1.2.0',
    })
    expect(result.optionalDependencies).toEqual({
      'onnxruntime-node': '1.23.2',
    })
    expect(result).not.toHaveProperty('devDependencies')
    expect(result.scripts).not.toHaveProperty('postinstall')
  })
  it('拒绝未声明依赖与 Electron 依赖', () => {
    expect(() =>
      serverRuntimeManifest(['unknown'], pkg, () => '1.0.0')
    ).toThrow(/未声明/)
    expect(() =>
      serverRuntimeManifest(['electron'], pkg, () => '45.1.0')
    ).toThrow(/桌面或网页/)
  })
})

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'yingbox-package-'))
  roots.push(root)
  await mkdir(join(root, 'out/server/chunks'), { recursive: true })
  await mkdir(join(root, 'dist-web'), { recursive: true })
  await mkdir(join(root, 'licenses'))
  for (const file of [
    'server.js',
    'engine.js',
    'webp-worker.js',
    'chunks/codec.js',
    'server.js.map',
  ])
    await writeFile(join(root, 'out/server', file), '// fixture')
  for (const file of [
    'LICENSE',
    'THIRD_PARTY_NOTICES.md',
    'licenses/test.txt',
    'dist-web/index.html',
  ])
    await writeFile(join(root, file), 'fixture')
  await writeFile(
    join(root, 'out/server/runtime-package.json'),
    JSON.stringify({
      name: 'yingbox-server',
      version: '1.0.1',
      homepage: 'https://example.com',
      dependencies: { cheerio: '1.2.0' },
    })
  )
  return root
}

describe('独立服务安装目录', () => {
  it('携带引擎、编解码线程和分块，不带网页、源码映射或构建清单', async () => {
    const target = await stageServerPackage(await fixture())
    for (const file of [
      'out/server/engine.js',
      'out/server/webp-worker.js',
      'out/server/chunks/codec.js',
      'LICENSE',
      'licenses/test.txt',
    ])
      await expect(access(join(target, file))).resolves.toBeUndefined()
    for (const file of [
      'dist-web',
      'out/server/server.js.map',
      'out/server/runtime-package.json',
    ])
      await expect(access(join(target, file))).rejects.toThrow()
    expect(
      JSON.parse(await readFile(join(target, 'package.json'), 'utf8'))
        .dependencies
    ).toEqual({ cheerio: '1.2.0' })
  })
  it('含网页包保留自动发现所需的目录结构，重复打包不会留下文件', async () => {
    const root = await fixture()
    const target = await stageServerPackage(root, true)
    await expect(
      access(join(target, 'dist-web/index.html'))
    ).resolves.toBeUndefined()
    await writeFile(join(target, 'stale.txt'), 'old')
    await stageServerPackage(root, true)
    await expect(access(join(target, 'stale.txt'))).rejects.toThrow()
    expect(
      JSON.parse(await readFile(join(target, 'package.json'), 'utf8')).name
    ).toBe('yingbox-server-web')
  })
  it('缺少工作进程或网页时拒绝打包', async () => {
    const root = await fixture()
    await rm(join(root, 'dist-web/index.html'))
    await expect(stageServerPackage(root, true)).rejects.toThrow()
    await rm(join(root, 'out/server/engine.js'))
    await expect(stageServerPackage(root)).rejects.toThrow()
  })
})
