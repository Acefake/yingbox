import translations from './settings-zh-CN.json'
export type Value =
  | string
  | number
  | boolean
  | null
  | Value[]
  | { [key: string]: Value }
export interface Schema {
  type?: string
  $ref?: string
  title?: string
  description?: string
  default?: Value
  enum?: Value[]
  const?: Value
  properties?: Record<string, Schema>
  items?: Schema
  additionalProperties?: Schema | boolean
  propertyNames?: Schema
  anyOf?: Schema[]
  oneOf?: Schema[]
  minimum?: number
  maximum?: number
  exclusiveMinimum?: number
  exclusiveMaximum?: number
  minLength?: number
  maxLength?: number
  pattern?: string
  minItems?: number
  maxItems?: number
  [key: string]: unknown
}
export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
export type Config = Record<string, Record<string, Value>>
export function configPatch(
  draft: Config,
  baseline: Config,
  root: Schema
): Config {
  const patch: Config = {}
  for (const [section, values] of Object.entries(draft)) {
    const fields =
      resolveSchema(root.properties?.[section] || {}, root).properties || {}
    const changes = Object.fromEntries(
      Object.entries(values)
        .filter(
          ([key, value]) =>
            JSON.stringify(value) !== JSON.stringify(baseline[section]?.[key])
        )
        .map(([key, value]) => [
          key,
          encodeValue(fields[key] || {}, value, root),
        ])
    )
    if (Object.keys(changes).length) patch[section] = changes
  }
  return patch
}
export function resolveSchema(
  input: Schema,
  root: Record<string, unknown>,
  visited = new Set<string>()
): Schema {
  let schema: Schema = { ...input }
  if (schema.$ref?.startsWith('#/') && !visited.has(schema.$ref)) {
    const seen = new Set(visited)
    seen.add(schema.$ref)
    let node: unknown = root
    for (const key of schema.$ref.slice(2).split('/'))
      node = (node as Record<string, unknown> | undefined)?.[
        key.replace(/~1/g, '/').replace(/~0/g, '~')
      ]
    if (node && typeof node === 'object') {
      const resolvedNode = resolveSchema(node as Schema, root, seen)
      schema = Object.assign({}, resolvedNode, schema, { $ref: undefined })
    }
  }
  const branches = schema.anyOf || schema.oneOf
  if (branches) {
    const nonNull = branches
      .map(item => resolveSchema(item, root, visited))
      .filter(item => item.type !== 'null')
    if (nonNull.length === 1) {
      schema = Object.assign({}, nonNull[0], schema, {
        nullable: branches.some(item => item.type === 'null'),
        anyOf: undefined,
        oneOf: undefined,
      })
    }
  }
  return schema
}
export function text(path: string, suffix: string, fallback = ''): string {
  let node: unknown = translations.fields
  for (const key of `${path}.${suffix}`.split('.'))
    node = (node as Record<string, unknown> | undefined)?.[key]
  return typeof node === 'string' ? node : fallback
}
export function sectionLabel(key: string): string {
  return (
    (translations.tabs as Record<string, string>)[key] ||
    (key === 'r18' ? 'r18' : key)
  )
}
export function initialValue(
  input: Schema,
  root: Record<string, unknown>
): Value {
  const schema = resolveSchema(input, root)
  if (schema.default !== undefined) return clone(schema.default)
  if (schema.const !== undefined) return schema.const
  if (schema.type === 'object')
    return Object.fromEntries(
      Object.entries(schema.properties || {})
        .filter(([, child]) => !resolveSchema(child, root)['x-hidden'])
        .map(([key, child]) => [key, initialValue(child, root)])
    )
  if (schema.type === 'array') return []
  if (schema.nullable) return null
  if (schema.enum?.length) return schema.enum[0]
  if (schema.type === 'boolean') return false
  if (schema.type === 'number' || schema.type === 'integer')
    return schema.minimum || 0
  return ''
}
export function encodeValue(
  input: Schema,
  value: Value,
  root: Record<string, unknown>
): Value {
  const schema = resolveSchema(input, root)
  if (value === '' && schema.nullable) return null
  if (Array.isArray(value))
    return value.map(item => encodeValue(schema.items || {}, item, root))
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        encodeValue(
          schema.properties?.[key] ||
            (typeof schema.additionalProperties === 'object'
              ? schema.additionalProperties
              : {}),
          child,
          root
        ),
      ])
    )
  return value
}
