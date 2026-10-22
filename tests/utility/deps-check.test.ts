/** 启动前依赖检查（scripts/deps-check.mjs）：声明了但没装的包。 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { missingDependencies } from '../../scripts/deps-check.mjs'

describe('missingDependencies', () => {
  it('列出 dependencies / devDependencies 里 node_modules 下找不到的包（含作用域包）', () => {
    const root = mkdtempSync(join(tmpdir(), 'deps-'))
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        dependencies: { vue: '3', '@jsquash/resize': '2' },
        devDependencies: { vitest: '3' },
      })
    )
    mkdirSync(join(root, 'node_modules', 'vue'), { recursive: true })
    writeFileSync(join(root, 'node_modules', 'vue', 'package.json'), '{}')
    expect(missingDependencies(root)).toEqual(['@jsquash/resize', 'vitest'])
  })
})
