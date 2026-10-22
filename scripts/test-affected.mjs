#!/usr/bin/env node
/**
 * 按改动选测（pnpm test:affected）：开发中只跑受这次改动影响的测试；合并前仍跑全套。
 *
 * 改动 = 工作区（含未提交、未跟踪文件）相对基线（默认 origin/main 与 HEAD 的 merge-base）的差异。
 * 每个文件依次判定：
 *   1. 只改了注释 / 空白 / 格式 → 跳过。TS / JS 用 typescript 解析成语法树后取指纹（注释、
 *      引号、分号、尾逗号不进指纹）；.vue 分块（模板去 HTML 注释、脚本走语法树、样式去注释）；
 *      .css 去注释压空白；.json 解析后比较（package.json 不计 description / keywords）。
 *   2. 共享设施（SHARED_INFRA：依赖与锁文件、vite / vitest / tsconfig / eslint 配置、
 *      src/shared/**、scripts/**、测试 setup）或删除的代码文件 → 全量。
 *   3. 代码文件 → 交给 vitest 的依赖图（related）找出 import 了它的测试；改的是测试本身就跑它。
 *      只要有代码改动，再加上整仓扫描类测试（文件里写了 `test-affected: repo-wide` 的测试，
 *      如行数、样式、文案、模块边界门槛，它们读源码文本，依赖图看不到）。
 *   4. 其他文件（文档、测试数据、配置）→ 在测试源码里按文件名 / 所在目录查引用，跑引用了它的
 *      测试；没人引用时，文档与 NO_TEST 里的文件跳过，其余一律全量。
 *
 *   node scripts/test-affected.mjs                  选测并运行
 *   node scripts/test-affected.mjs --plan           只打印选测结果（不运行）
 *   node scripts/test-affected.mjs --base <ref>     指定基线（提交、分支或标签）
 *   node scripts/test-affected.mjs -- --reporter=dot 之后的参数原样传给 vitest
 */
import { spawnSync, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { parse as parseSfc } from 'vue/compiler-sfc'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** 改了就退回全量的共享设施 */
export const SHARED_INFRA = [
  /^package\.json$/,
  /^pnpm-(?:lock|workspace)\.yaml$/,
  /^\.npmrc$/,
  /^(?:vitest|vite|electron\.vite)\.config(?:\.[\w-]+)*\.[cm]?[jt]s$/,
  /^tsconfig(?:\.[\w-]+)*\.json$/,
  /^eslint\.config\.[cm]?js$/,
  /^postcss\.config\.[cm]?js$/,
  /^src\/shared\//,
  /^scripts\//,
  /^tests\/(?:.*\/)?setup[\w.-]*\.[cm]?[jt]s$/,
]

/** 不被任何测试读取的打包 / 部署 / 编辑器文件：没人引用时跳过（有引用照样跑引用者） */
export const NO_TEST = [
  /^\.(?:gitignore|gitattributes|prettierrc|prettierignore|dockerignore|env\.example)$/,
  /^(?:Dockerfile|docker-compose[\w.-]*\.ya?ml|electron-builder\.ya?ml|dev-app-update\.yml|\.gitlab-ci\.yml)$/,
  /^(?:build|resources)\//,
]

const CODE = /\.(?:[cm]?[jt]sx?|vue|css)$/
const TEST = /^tests\/.*\.test\.[cm]?[jt]sx?$/
const REPO_WIDE_MARK = 'test-affected: repo-wide'

/** 文档：任何 .md 与 docs/ 下的文件 */
export function isDoc(path) {
  return path.endsWith('.md') || path.startsWith('docs/')
}

/**
 * 文件内容的「行为指纹」：只改注释、空白、格式时不变。认不出的类型或解析失败返回 null（按有改动处理）。
 *
 * @param {string} path 仓库相对路径（决定按哪种语法解析）
 * @param {string} text 文件内容
 * @returns {string | null}
 */
export function fingerprint(path, text) {
  try {
    if (/\.[cm]?[jt]sx?$/.test(path)) return hash(scriptShape(path, text))
    if (path.endsWith('.vue')) return hash(vueShape(text))
    if (path.endsWith('.css')) return hash(cssShape(text))
    if (path.endsWith('.json')) {
      const data = JSON.parse(text)
      if (
        basename(path) === 'package.json' &&
        data &&
        typeof data === 'object'
      ) {
        delete data.description
        delete data.keywords
      }
      return hash(JSON.stringify(data))
    }
  } catch {
    return null
  }
  return null
}

/**
 * 一个文件的改动类别：prose（只动注释 / 格式）| logic（有实质改动）| added | deleted。
 *
 * @param {string} path 仓库相对路径
 * @param {string | null} before 基线里的内容（新增为 null）
 * @param {string | null} after 工作区里的内容（删除为 null）
 */
export function classify(path, before, after) {
  if (before == null) return 'added'
  if (after == null) return 'deleted'
  const a = fingerprint(path, before)
  const same = a !== null && a === fingerprint(path, after)
  return same && directives(before) === directives(after) ? 'prose' : 'logic'
}

/** 会改变工具行为的注释（eslint / vitest / ts 指令、本仓库各检查的豁免标记），改了不算「只动注释」 */
const DIRECTIVE =
  /eslint-(?:disable|enable)|@vitest-|@ts-|style-tokens:|copy-lint:|test-affected:|prettier-ignore/

function directives(text) {
  return text
    .split('\n')
    .filter(line => DIRECTIVE.test(line))
    .map(line => line.trim())
    .join('\n')
}

/**
 * 根据改动定下跑哪些测试（纯函数）。
 *
 * @param {{ path: string, before: string | null, after: string | null }[]} changes 改动的文件
 * @param {Map<string, string>} testSources tests/ 下每个 .ts / .js 文件（测试与辅助文件）→ 内容
 * @returns {{ mode: 'skip' | 'related' | 'full', reasons: string[], related: string[], tests: string[] }}
 *   related：交给 vitest 依赖图的源文件；tests：直接要跑的测试文件
 */
export function planAffected(changes, testSources) {
  const reasons = []
  const related = new Set()
  const tests = new Set()
  let full = false
  let codeChanged = false
  for (const { path, before, after } of changes) {
    const kind = classify(path, before, after)
    if (kind === 'prose') {
      reasons.push(`${path}: 只改注释 / 格式，跳过`)
      continue
    }
    if (SHARED_INFRA.some(re => re.test(path))) {
      reasons.push(`${path}: 共享设施 → 全量`)
      full = true
      continue
    }
    if (CODE.test(path)) {
      if (kind === 'deleted') {
        if (!TEST.test(path)) {
          reasons.push(`${path}: 删除了代码文件 → 全量`)
          full = true
        }
        continue
      }
      codeChanged = true
      if (TEST.test(path)) tests.add(path)
      else related.add(path)
      reasons.push(`${path}: 代码 → 依赖图`)
      continue
    }
    const users = referencingTests(path, testSources)
    for (const user of users) (TEST.test(user) ? tests : related).add(user)
    if (users.length) reasons.push(`${path}: 被 ${users.join('、')} 引用`)
    else if (isDoc(path) || NO_TEST.some(re => re.test(path)))
      reasons.push(`${path}: 没有测试引用，跳过`)
    else {
      reasons.push(`${path}: 非代码文件且没有测试引用 → 全量`)
      full = true
    }
  }
  if (full) return { mode: 'full', reasons, related: [], tests: [] }
  if (codeChanged)
    for (const [file, text] of testSources)
      if (TEST.test(file) && text.includes(REPO_WIDE_MARK)) tests.add(file)
  const mode = related.size || tests.size ? 'related' : 'skip'
  return {
    mode,
    reasons,
    related: [...related].sort(),
    tests: [...tests].sort(),
  }
}

/** 测试源码里按文件名、仓库相对路径或「上级目录/本级目录」引用了 path 的文件 */
function referencingTests(path, testSources) {
  const dir = dirname(path).split('/').slice(-2).join('/')
  const needles = [basename(path), path]
  if (dir.includes('/')) needles.push(dir)
  return [...testSources]
    .filter(
      ([file, text]) => file !== path && needles.some(n => text.includes(n))
    )
    .map(([file]) => file)
    .sort()
}

/**
 * 读出工作区相对基线的改动（git）。
 *
 * @param {string} cwd 仓库根
 * @param {string} base 基线引用；与 HEAD 取 merge-base
 * @returns {{ path: string, before: string | null, after: string | null }[]}
 */
export function collectChanges(cwd, base) {
  const git = args =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 64 << 20,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  const mergeBase = git(['merge-base', 'HEAD', base]).trim()
  const tracked = git(['diff', '--name-only', '--no-renames', '-z', mergeBase])
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z'])
  const paths = [...new Set([...tracked.split('\0'), ...untracked.split('\0')])]
    .filter(Boolean)
    .sort()
  return paths.map(path => {
    let before = null
    try {
      before = git(['show', `${mergeBase}:${path}`])
    } catch {
      // 基线里没有：新增文件
    }
    const full = join(cwd, path)
    return {
      path,
      before,
      after: existsSync(full) ? readFileSync(full, 'utf8') : null,
    }
  })
}

/** tests/ 下全部 .ts / .js 文件 → 内容 */
export function readTestSources(cwd) {
  const out = new Map()
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.[cm]?[jt]sx?$/.test(entry.name))
        out.set(
          relative(cwd, full).split('\\').join('/'),
          readFileSync(full, 'utf8')
        )
    }
  }
  walk(join(cwd, 'tests'))
  return out
}

/** 用 vitest 的依赖图找出 import（直接或间接）了这些源文件的测试 */
async function relatedTests(cwd, sources) {
  if (!sources.length) return []
  const { createVitest } = await import('vitest/node')
  const vitest = await createVitest('test', {
    root: cwd,
    watch: false,
    related: sources.map(file => resolve(cwd, file)),
    passWithNoTests: true,
  })
  try {
    const specs = await vitest.getRelevantTestSpecifications()
    return specs.map(spec => relative(cwd, spec.moduleId).split('\\').join('/'))
  } finally {
    await vitest.close()
  }
}

async function main() {
  const argv = process.argv.slice(2)
  const passIndex = argv.indexOf('--')
  const own = passIndex >= 0 ? argv.slice(0, passIndex) : argv
  const passthrough = passIndex >= 0 ? argv.slice(passIndex + 1) : []
  const baseIndex = own.indexOf('--base')
  const base = baseIndex >= 0 ? own[baseIndex + 1] : 'origin/main'
  const planOnly = own.includes('--plan')

  const plan = planAffected(collectChanges(ROOT, base), readTestSources(ROOT))
  const tests =
    plan.mode === 'related'
      ? [
          ...new Set([
            ...plan.tests,
            ...(await relatedTests(ROOT, plan.related)),
          ]),
        ].sort()
      : []
  for (const line of plan.reasons) console.log(`  ${line}`)
  if (plan.mode === 'full') console.log(`选测：全量（相对 ${base}）`)
  else if (!tests.length) console.log(`选测：没有受影响的测试（相对 ${base}）`)
  else
    console.log(
      `选测：${tests.length} 个测试文件（相对 ${base}）\n${tests.map(t => `    ${t}`).join('\n')}`
    )
  if (planOnly || (plan.mode !== 'full' && !tests.length)) return

  const result = spawnSync('npx', ['vitest', 'run', ...tests, ...passthrough], {
    cwd: ROOT,
    stdio: 'inherit',
  })
  process.exitCode = result.status ?? 1
}

/** 脚本 / 模板 / 样式的规范化形状（注释、空白、引号、分号、尾逗号都不进来） */
function scriptShape(path, text) {
  const kind = /\.[cm]?tsx$/.test(path)
    ? ts.ScriptKind.TSX
    : /\.[cm]?jsx?$/.test(path)
      ? ts.ScriptKind.JS
      : ts.ScriptKind.TS
  const file = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    false,
    kind
  )
  if (file.parseDiagnostics?.length) throw new Error('语法错误')
  const parts = []
  const blockScoped = ts.NodeFlags.BlockScoped | ts.NodeFlags.Using
  const visit = node => {
    let tag = String(node.kind)
    for (const key of ['operator', 'keywordToken', 'token'])
      if (typeof node[key] === 'number') tag += `:${node[key]}`
    if (node.flags & blockScoped) tag += `f${node.flags & blockScoped}`
    let open = false
    ts.forEachChild(node, child => {
      if (!open) parts.push(`${tag}(`)
      open = true
      visit(child)
    })
    parts.push(open ? ')' : `${tag}=${leafText(node, file)}`)
  }
  visit(file)
  return parts.join('\n')
}

/** 叶子节点的文本：字符串 / 模板片段取解码后的值（引号风格不算改动），其余取源码 */
function leafText(node, file) {
  if (
    ts.isStringLiteralLike(node) ||
    ts.isTemplateLiteralToken(node) ||
    ts.isNumericLiteral(node)
  )
    return JSON.stringify(node.text)
  return node.getText(file)
}

function vueShape(text) {
  const { descriptor, errors } = parseSfc(text, { ignoreEmpty: false })
  if (errors.length) throw new Error('SFC 语法错误')
  const attrs = block => JSON.stringify(block.attrs)
  const parts = []
  if (descriptor.template)
    parts.push(
      `template${attrs(descriptor.template)}`,
      descriptor.template.content
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\s+/g, ' ')
        .replace(/\s*(\/?>)/g, '$1')
        .replace(/>\s+</g, '><')
        .trim()
    )
  for (const script of [descriptor.script, descriptor.scriptSetup].filter(
    Boolean
  ))
    parts.push(
      `script${attrs(script)}`,
      scriptShape(`x.${script.lang || 'js'}`, script.content)
    )
  for (const style of descriptor.styles)
    parts.push(`style${attrs(style)}`, cssShape(style.content))
  for (const block of descriptor.customBlocks)
    parts.push(`${block.type}${attrs(block)}`, block.content)
  return parts.join('\n')
}

function cssShape(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{};,])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim()
}

function hash(text) {
  return createHash('sha256').update(text).digest('hex')
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main()
