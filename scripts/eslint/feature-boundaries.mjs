/**
 * ESLint 本地规则：feature 边界（yingbox/feature-boundaries）。
 *
 * 渲染层 src/renderer/src/features/<x>/ 下的文件引用别的 feature 时，只能经它的公共出口
 * features/<y>/index.ts（写作 `@/features/y` 或相对路径指向该目录/index）。同一 feature 内部、
 * 共享模块（components/ui、utils、types 等）、以及 feature 之外的组合层（main.ts、App.vue、router/）不受限。
 * 静态 import、export … from、动态 import() 都检查。
 */
import { dirname, join, normalize, relative, sep } from 'node:path'

const FEATURES = join('src', 'renderer', 'src', 'features')

/**
 * 把 import 路径解析成相对仓库根的路径；不是 `@/` 或相对路径时返回 null。
 * @param {string} spec import 路径
 * @param {string} file 发起引用的文件（相对仓库根）
 */
function resolveSpec(spec, file) {
  if (spec.startsWith('@/')) return normalize(join('src', 'renderer', 'src', spec.slice(2)))
  if (spec.startsWith('.')) return normalize(join(dirname(file), spec))
  return null
}

/**
 * 返回路径所在的 feature 名与其后的子路径；不在 features/ 下返回 null。
 * @param {string} path 相对仓库根的路径
 */
export function featureOf(path) {
  const rest = relative(FEATURES, path)
  if (rest.startsWith('..') || rest === '') return null
  const [name, ...inner] = rest.split(sep)
  return { name, inner: inner.join('/') }
}

/**
 * 判断 file 引用 spec 是否越过 feature 边界；越界时返回目标 feature 名，否则 null。
 * @param {string} file 发起引用的文件（相对仓库根）
 * @param {string} spec import 路径
 */
export function boundaryViolation(file, spec) {
  const from = featureOf(normalize(file))
  if (!from) return null
  const target = resolveSpec(spec, file)
  if (!target) return null
  const to = featureOf(target)
  if (!to || to.name === from.name) return null
  return ['', 'index', 'index.ts'].includes(to.inner) ? null : to.name
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    messages: {
      deep: '跨 feature 只能经公共出口引用：改为 `@/features/{{name}}`（在 features/{{name}}/index.ts 导出所需成员）。',
    },
    schema: [],
  },
  create(context) {
    const file = relative(context.cwd, context.filename)
    const check = node => {
      const source = node.source
      if (!source || source.type !== 'Literal' || typeof source.value !== 'string') return
      const name = boundaryViolation(file, source.value)
      if (name) context.report({ node: source, messageId: 'deep', data: { name } })
    }
    return {
      ImportDeclaration: check,
      ExportNamedDeclaration: check,
      ExportAllDeclaration: check,
      ImportExpression: check,
    }
  },
}

/** 以插件形式导出，供 eslint.config.mjs 注册为 yingbox/feature-boundaries */
export default { rules: { 'feature-boundaries': rule } }
