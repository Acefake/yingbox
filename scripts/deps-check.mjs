/**
 * 启动前的依赖检查：package.json 里声明的包在 node_modules 里找不到，就是拉了新代码还没装依赖。
 *
 * 不检查就启动的后果：后台引擎 import 不到新依赖、一启动就崩，渲染层的每次调用又会拉起一个新进程，
 * Windows 上能把整机拖死、窗口一直白屏（主进程侧另有崩溃守卫兜底，见 src/main/utility/crash-guard.ts）。
 * 只看包目录是否存在，不比版本：够快（启动时每次都跑），漏掉的版本差异由 pnpm install 自己处理。
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * 声明了但 node_modules 里没有的包名（dependencies + devDependencies）。
 * @param {string} root 项目根目录
 * @param {(file: string) => boolean} [exists] 测试注入
 * @returns {string[]}
 */
export function missingDependencies(root, exists = existsSync) {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  const names = Object.keys({
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
  })
  return names.filter(
    name => !exists(path.join(root, 'node_modules', name, 'package.json'))
  )
}
