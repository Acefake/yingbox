/**
 * 按改动选测（scripts/test-affected.mjs）：只动注释 / 格式的文件跳过；共享设施、删除的代码文件退回全量；
 * 代码交给依赖图并带上整仓扫描类测试；非代码文件按测试源码里的引用选测，没人引用时文档跳过、其余全量。
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  classify,
  collectChanges,
  fingerprint,
  planAffected,
} from '../../scripts/test-affected.mjs'

const TS = `/** 文档 */
import { a } from './a'
// 行注释
export function f(x: number): string {
  let n = x + 1
  n++
  return 'v' + a(n)
}
`

describe('fingerprint：只改注释 / 空白 / 格式时不变', () => {
  it('TS：注释、空行、缩进、引号、分号、尾逗号都不算', () => {
    const reformatted = `import { a } from "./a";

export function f(
  x: number,
): string {
      /* 块注释 */ let n = x + 1;
  n++;
  return "v" + a(n);
}
`
    expect(fingerprint('src/x.ts', reformatted)).toBe(
      fingerprint('src/x.ts', TS)
    )
  })

  it.each([
    ['运算符', 'n++', 'n--'],
    ['let → const', 'let n = x + 1', 'const n = x + 1'],
    ['字符串内容', "'v'", "'w'"],
    ['标识符', 'a(n)', 'a(x)'],
    ['二元运算符', 'x + 1', 'x - 1'],
    ['数字', 'x + 1', 'x + 2'],
  ])('TS：%s 变了就不同', (_name, from, to) => {
    expect(fingerprint('src/x.ts', TS.replace(from, to))).not.toBe(
      fingerprint('src/x.ts', TS)
    )
  })

  it('TS：语法错误返回 null（按有改动处理）', () => {
    expect(fingerprint('src/x.ts', 'export const a = (')).toBeNull()
  })

  it('JS / mjs 也按语法树比较', () => {
    expect(fingerprint('scripts/a.mjs', 'export const a = 1 // x\n')).toBe(
      fingerprint('scripts/a.mjs', 'export const a = 1;\n')
    )
  })

  const VUE = `<template>
  <div class="a">
    <!-- 注释 -->
    <span>{{ label }}</span>
  </div>
</template>

<script setup lang="ts">
// 注释
const label = 'x'
</script>

<style scoped>
/* 注释 */
.a { color: var(--text-primary); }
</style>
`
  it('Vue：模板 / 脚本 / 样式里的注释与格式不算', () => {
    const reformatted = VUE.replace('<!-- 注释 -->', '')
      .replace('// 注释', '/** 另一种注释 */')
      .replace('/* 注释 */', '')
      .replace(
        '.a { color: var(--text-primary); }',
        '.a {\n  color: var(--text-primary)\n}'
      )
      .replace('<div class="a">', '<div\n    class="a"\n  >')
    expect(fingerprint('src/A.vue', reformatted)).toBe(
      fingerprint('src/A.vue', VUE)
    )
  })

  it.each([
    ['模板文字', '<span>{{ label }}</span>', '<span>{{ label }}!</span>'],
    ['脚本', "const label = 'x'", "const label = 'y'"],
    ['样式', 'var(--text-primary)', 'var(--text-secondary)'],
    ['块属性', '<style scoped>', '<style>'],
  ])('Vue：%s 变了就不同', (_name, from, to) => {
    expect(fingerprint('src/A.vue', VUE.replace(from, to))).not.toBe(
      fingerprint('src/A.vue', VUE)
    )
  })

  it('package.json：description 不算，依赖算', () => {
    const pkg = { name: 'x', description: 'a', dependencies: { vue: '1.0.0' } }
    const json = (v: object): string => JSON.stringify(v, null, 2)
    expect(
      classify('package.json', json(pkg), json({ ...pkg, description: 'b' }))
    ).toBe('prose')
    expect(
      classify(
        'package.json',
        json(pkg),
        json({ ...pkg, dependencies: { vue: '1.0.1' } })
      )
    ).toBe('logic')
  })

  it('改了 eslint / vitest 指令或豁免标记的注释不算「只动注释」', () => {
    const withDirective = TS.replace(
      '// 行注释',
      '// eslint-disable-next-line no-console'
    )
    expect(classify('src/x.ts', TS, withDirective)).toBe('logic')
    const css = '.a { gap: 3px; }\n'
    expect(
      classify(
        'src/a.css',
        css,
        '.a { gap: 3px; /* style-tokens: layout（x） */ }\n'
      )
    ).toBe('logic')
  })

  it('新增 / 删除', () => {
    expect(classify('src/x.ts', null, TS)).toBe('added')
    expect(classify('src/x.ts', TS, null)).toBe('deleted')
  })
})

describe('planAffected：选测决策', () => {
  const tests = new Map([
    ['tests/a.test.ts', "import { f } from '../src/main/a'"],
    [
      'tests/gate.test.ts',
      "// test-affected: repo-wide\nreadFileSync('AGENTS.md')",
    ],
    ['tests/adr.test.ts', "readdirSync('docs/adr')"],
    ['tests/jav.test.ts', "fixture('javbus.html')"],
    [
      'tests/helpers.ts',
      "readFileSync(join(__dirname, 'fixtures/tmdb', name))",
    ],
  ])
  type Change = { path: string; before: string | null; after: string | null }
  const change = (
    path: string,
    before: string | null,
    after: string | null
  ): Change => ({
    path,
    before,
    after,
  })

  it('只改注释 → 什么都不跑', () => {
    const plan = planAffected(
      [change('src/main/a.ts', TS, TS.replace('// 行注释', '// 改过的注释'))],
      tests
    )
    expect(plan.mode).toBe('skip')
    expect(plan.reasons.join()).toContain('只改注释')
  })

  it.each([
    'package.json',
    'pnpm-lock.yaml',
    'vitest.config.ts',
    'vite.config.web.ts',
    'electron.vite.config.ts',
    'tsconfig.node.json',
    'eslint.config.mjs',
    'src/shared/net/guard.ts',
    'scripts/style-tokens.mjs',
    'tests/setup.ts',
  ])('共享设施 %s → 全量', path => {
    expect(planAffected([change(path, 'a', 'b')], tests).mode).toBe('full')
  })

  it('删除代码文件 → 全量；删除测试文件不触发全量', () => {
    expect(planAffected([change('src/main/a.ts', TS, null)], tests).mode).toBe(
      'full'
    )
    expect(
      planAffected([change('tests/old.test.ts', TS, null)], tests).mode
    ).toBe('skip')
  })

  it('代码改动 → 交给依赖图，并带上整仓扫描类测试', () => {
    const plan = planAffected(
      [change('src/main/a.ts', TS, TS.replace('n++', 'n--'))],
      tests
    )
    expect(plan).toMatchObject({
      mode: 'related',
      related: ['src/main/a.ts'],
      tests: ['tests/gate.test.ts'],
    })
  })

  it('改的是测试本身 → 直接跑它', () => {
    const plan = planAffected(
      [change('tests/a.test.ts', TS, TS.replace('n++', 'n--'))],
      tests
    )
    expect(plan.tests).toEqual(['tests/a.test.ts', 'tests/gate.test.ts'])
    expect(plan.related).toEqual([])
  })

  it('新增代码文件 → 依赖图', () => {
    expect(
      planAffected([change('src/main/b.ts', null, TS)], tests).related
    ).toEqual(['src/main/b.ts'])
  })

  it('文档：被测试引用就跑引用者（按文件名或所在目录），否则跳过；不带整仓测试', () => {
    expect(planAffected([change('AGENTS.md', 'a', 'b')], tests)).toMatchObject({
      mode: 'related',
      tests: ['tests/gate.test.ts'],
    })
    expect(
      planAffected([change('docs/adr/0001-x.md', 'a', 'b')], tests).tests
    ).toEqual(['tests/adr.test.ts'])
    expect(
      planAffected([change('docs/perf/baseline.md', 'a', 'b')], tests).mode
    ).toBe('skip')
  })

  it('测试数据：引用它的测试直接跑，引用它的辅助文件交给依赖图', () => {
    expect(
      planAffected([change('tests/fixtures/jav/javbus.html', 'a', 'b')], tests)
        .tests
    ).toEqual(['tests/jav.test.ts'])
    expect(
      planAffected(
        [change('tests/fixtures/tmdb/movie-1.json', 'a', 'b')],
        tests
      ).related
    ).toEqual(['tests/helpers.ts'])
  })

  it('没人引用的非代码文件 → 全量；打包 / 部署文件跳过', () => {
    expect(
      planAffected([change('cms-sites.json', '{}', '{"a":1}')], tests).mode
    ).toBe('full')
    expect(
      planAffected([change('electron-builder.yml', 'a', 'b')], tests).mode
    ).toBe('skip')
    expect(
      planAffected([change('resources/icon.png', 'a', 'b')], tests).mode
    ).toBe('skip')
  })

  it('多个改动里只要一个要全量就全量', () => {
    const plan = planAffected(
      [
        change('src/main/a.ts', TS, TS.replace('n++', 'n--')),
        change('src/shared/x.ts', 'a', 'b'),
      ],
      tests
    )
    expect(plan.mode).toBe('full')
  })
})

describe('collectChanges：工作区相对基线的改动（含未跟踪、删除）', () => {
  let dir = ''
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('读出改动、新增、删除文件的前后内容', () => {
    dir = mkdtempSync(join(tmpdir(), 'affected-'))
    const git = (...args: string[]): string =>
      execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 't@example.com')
    git('config', 'user.name', 't')
    writeFileSync(join(dir, 'a.ts'), 'export const a = 1\n')
    writeFileSync(join(dir, 'c.ts'), 'export const c = 1\n')
    git('add', '.')
    git('commit', '-qm', 'base')
    git('checkout', '-qb', 'work')
    writeFileSync(join(dir, 'a.ts'), '// 注释\nexport const a = 1\n')
    git('commit', '-qam', 'comment')
    writeFileSync(join(dir, 'b.ts'), 'export const b = 2\n')
    unlinkSync(join(dir, 'c.ts'))

    expect(collectChanges(dir, 'main')).toEqual([
      {
        path: 'a.ts',
        before: 'export const a = 1\n',
        after: '// 注释\nexport const a = 1\n',
      },
      { path: 'b.ts', before: null, after: 'export const b = 2\n' },
      { path: 'c.ts', before: 'export const c = 1\n', after: null },
    ])
  })
})
