/**
 * 视图类型 → Kotlin（ADR-0030）：从 src/shared/view 的描述生成数据类与 org.json 解析函数。
 *
 *   pnpm gen:view-kotlin        # 写入 android/.../view/ViewModels.kt
 *
 * tests/view-kotlin.test.ts 重新生成并与仓库里的文件比较，描述改了却没重新生成时测试失败。
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { VIEW_ROOTS } from '../src/shared/view'
import type {
  EnumSchema,
  ObjectSchema,
  Schema,
} from '../src/shared/view/schema'

export const KOTLIN_FILE = join(
  __dirname,
  '../android/app/src/main/kotlin/com/yingbox/android/view/ViewModels.kt'
)

type Named = EnumSchema<string> | ObjectSchema<Record<string, Schema>>

/** Kotlin 硬关键字：不能直接当属性名 */
const KOTLIN_KEYWORDS = new Set(
  'as break class continue do else false for fun if in interface is null object package return super this throw true try typealias typeof val var when while'.split(
    ' '
  )
)

/** 生成器不支持、会生成编不过的 Kotlin 的写法，生成时直接报错 */
function check(schema: Named): void {
  if (schema.kind === 'enum') {
    const names = schema.values.map(constName)
    const clash = names.find((name, i) => names.indexOf(name) !== i)
    if (clash) throw new Error(`枚举 ${schema.name} 的常量名冲突：${clash}`)
    return
  }
  for (const [field, value] of Object.entries(schema.fields)) {
    if (KOTLIN_KEYWORDS.has(field))
      throw new Error(`${schema.name}.${field} 是 Kotlin 关键字`)
    if (value.kind === 'nullable' && value.of.kind === 'nullable')
      throw new Error(`${schema.name}.${field} 是可空套可空`)
  }
}

/** 从根出发收集具名类型（先出现的先生成），同名不同形状报错 */
function collect(roots: readonly Schema[]): Named[] {
  const found = new Map<string, Named>()
  const visit = (schema: Schema): void => {
    if (schema.kind === 'nullable' || schema.kind === 'array') {
      visit(schema.of)
      return
    }
    if (schema.kind !== 'enum' && schema.kind !== 'object') return
    const seen = found.get(schema.name)
    if (seen) {
      if (JSON.stringify(seen) !== JSON.stringify(schema))
        throw new Error(`视图类型重名但形状不同：${schema.name}`)
      return
    }
    check(schema)
    found.set(schema.name, schema)
    if (schema.kind === 'object') Object.values(schema.fields).forEach(visit)
  }
  roots.forEach(visit)
  return [...found.values()]
}

function kotlinType(schema: Schema): string {
  switch (schema.kind) {
    case 'string':
      return 'String'
    case 'number':
      return 'Double'
    case 'boolean':
      return 'Boolean'
    case 'nullable':
      return `${kotlinType(schema.of)}?`
    case 'array':
      return `List<${kotlinType(schema.of)}>`
    case 'enum':
    case 'object':
      return schema.name
  }
}

/**
 * 从 JSONObject（key 是 "名字"）或 JSONArray（key 是下标变量）读一个值的表达式。
 * @param depth 嵌套数组的层数，给 lambda 参数起不重名的名字
 */
function readExpr(schema: Schema, src: string, key: string, depth = 0): string {
  switch (schema.kind) {
    case 'string':
      return `${src}.getString(${key})`
    case 'number':
      return `${src}.getDouble(${key})`
    case 'boolean':
      return `${src}.getBoolean(${key})`
    case 'nullable':
      return `(if (${src}.isNull(${key})) null else ${readExpr(schema.of, src, key, depth)})`
    case 'array': {
      const a = `a${depth}`
      const i = `i${depth}`
      return `${src}.getJSONArray(${key}).let { ${a} -> List(${a}.length()) { ${i} -> ${readExpr(schema.of, a, i, depth + 1)} } }`
    }
    case 'enum':
      return `${schema.name}.fromJson(${src}.getString(${key}))`
    case 'object':
      return `${schema.name}.fromJson(${src}.getJSONObject(${key}))`
  }
}

const constName = (value: string): string =>
  value
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/\W/g, '_')
    .toUpperCase()

function enumClass(schema: EnumSchema<string>): string {
  const entries = schema.values
    .map(v => `    ${constName(v)}(${JSON.stringify(v)}),`)
    .join('\n')
  return `enum class ${schema.name}(val json: String) {
${entries}
    ;

    companion object {
        fun fromJson(value: String): ${schema.name} =
            entries.firstOrNull { it.json == value }
                ?: throw IllegalArgumentException("未知的 ${schema.name}：$value")
    }
}`
}

function dataClass(schema: ObjectSchema<Record<string, Schema>>): string {
  const fields = Object.entries(schema.fields)
  const props = fields
    .map(([name, field]) => `    val ${name}: ${kotlinType(field)},`)
    .join('\n')
  const reads = fields
    .map(
      ([name, field]) =>
        `            ${name} = ${readExpr(field, 'json', JSON.stringify(name))},`
    )
    .join('\n')
  return `data class ${schema.name}(
${props}
) {
    companion object {
        fun fromJson(json: JSONObject): ${schema.name} = ${schema.name}(
${reads}
        )
    }
}`
}

/** 生成 ViewModels.kt 的全文 */
export function generateKotlin(roots: readonly Schema[] = VIEW_ROOTS): string {
  const blocks = collect(roots).map(schema =>
    schema.kind === 'enum' ? enumClass(schema) : dataClass(schema)
  )
  return `// 由 scripts/gen-view-kotlin.ts 从 src/shared/view 生成，不要手改（ADR-0030）。
// 改了视图描述后运行 pnpm gen:view-kotlin。
package com.yingbox.android.view

import org.json.JSONObject

${blocks.join('\n\n')}
`
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  writeFileSync(KOTLIN_FILE, generateKotlin())
  console.log(`已生成 ${KOTLIN_FILE}`)
}
