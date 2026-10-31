/** 从服务构建的外部模块生成独立运行依赖，不携带桌面或网页运行库。 */
import { readFileSync } from 'node:fs'
import { createRequire, isBuiltin } from 'node:module'
import { dirname, join } from 'node:path'
import type { Plugin } from 'vite'

interface SourcePackage {
  version: string
  license: string
  homepage: string
  dependencies: Record<string, string>
}

/** 包的 exports 不一定开放 package.json，沿实际入口向上找同名清单。 */
function installedVersion(name: string, root: string): string {
  const require = createRequire(join(root, 'package.json'))
  let dir = dirname(require.resolve(name))
  for (;;) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
      if (pkg.name === name) return pkg.version
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const parent = dirname(dir)
    if (parent === dir) throw new Error(`找不到运行依赖的清单：${name}`)
    dir = parent
  }
}

/** 独立包沿用构建时安装的精确版本；未声明依赖或桌面依赖直接使构建失败。 */
export function serverRuntimeManifest(
  ids: Iterable<string>,
  pkg: SourcePackage,
  versionOf: (name: string) => string
): Record<string, unknown> {
  const names = new Set<string>()
  for (const id of ids) {
    if (isBuiltin(id)) continue
    const name = id
      .split('/')
      .slice(0, id.startsWith('@') ? 2 : 1)
      .join('/')
    if (!pkg.dependencies[name]) throw new Error(`服务运行依赖未声明：${id}`)
    if (/^(electron|@electron|vue|@vue|artplayer|hls\.js)/.test(name))
      throw new Error(`独立后端包含桌面或网页依赖：${name}`)
    names.add(name)
  }
  const dependencies: Record<string, string> = {}
  const optionalDependencies: Record<string, string> = {}
  for (const name of [...names].sort()) {
    const target =
      name === 'onnxruntime-node' ? optionalDependencies : dependencies
    target[name] = versionOf(name)
  }
  return {
    name: 'yingbox-server',
    version: pkg.version,
    description: '影盒独立 Node.js 后端：片库、网盘、追更与媒体服务',
    private: true,
    type: 'commonjs',
    license: pkg.license,
    homepage: pkg.homepage,
    engines: { node: '>=22.13.0' },
    scripts: {
      start: 'node --disable-warning=ExperimentalWarning out/server/server.js',
    },
    files: [
      'out/server',
      'dist-web',
      'licenses',
      'LICENSE',
      'THIRD_PARTY_NOTICES.md',
      'README.md',
    ],
    dependencies,
    optionalDependencies,
  }
}

export function serverRuntimePackage(root: string, pkg: SourcePackage): Plugin {
  return {
    name: 'server-runtime-package',
    generateBundle(_options, bundle) {
      const externals = Object.values(bundle).flatMap(chunk =>
        chunk.type === 'chunk'
          ? [...chunk.imports, ...chunk.dynamicImports].filter(
              id => !bundle[id]
            )
          : []
      )
      // createRequire 的延迟加载和读取插件源码不会出现在 imports 中。
      const runtimeFiles = Object.values(bundle)
        .flatMap(chunk =>
          chunk.type === 'chunk' ? Object.keys(chunk.modules) : []
        )
        .map(id => id.replaceAll('\\', '/'))
      if (runtimeFiles.some(id => id.endsWith('/src/shared/html/cheerio.ts')))
        externals.push('cheerio')
      if (
        runtimeFiles.some(id =>
          id.endsWith('/src/engine/online/plugin-runtime.ts')
        )
      )
        externals.push('crypto-js')
      const manifest = serverRuntimeManifest(externals, pkg, name =>
        installedVersion(name, root)
      )
      this.emitFile({
        type: 'asset',
        fileName: 'runtime-package.json',
        source: `${JSON.stringify(manifest, null, 2)}\n`,
      })
    },
  }
}
