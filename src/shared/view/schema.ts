/**
 * 视图结果类型的描述（ADR-0030）：一个描述值同时推导 TS 类型（Infer），
 * 并由 scripts/gen-view-kotlin.ts 生成 Kotlin 数据类与 org.json 解析函数。
 *
 * 只支持视图里用到的形状；对象与枚举带名字，生成 Kotlin 时用作类名。
 */

/** 描述 */
export type Schema =
  | { readonly kind: 'string' }
  | { readonly kind: 'number' }
  | { readonly kind: 'boolean' }
  | { readonly kind: 'nullable'; readonly of: Schema }
  | { readonly kind: 'array'; readonly of: Schema }
  | EnumSchema<string>
  | ObjectSchema<Record<string, Schema>>

/** 字符串枚举 */
export interface EnumSchema<V extends string> {
  readonly kind: 'enum'
  readonly name: string
  readonly values: readonly V[]
}

/** 对象 */
export interface ObjectSchema<F extends Record<string, Schema>> {
  readonly kind: 'object'
  readonly name: string
  readonly fields: F
}

/** 描述对应的 TS 类型 */
export type Infer<S> = S extends { kind: 'string' }
  ? string
  : S extends { kind: 'number' }
    ? number
    : S extends { kind: 'boolean' }
      ? boolean
      : S extends { kind: 'nullable'; of: infer O }
        ? Infer<O> | null
        : S extends { kind: 'array'; of: infer O }
          ? Infer<O>[]
          : S extends EnumSchema<infer V>
            ? V
            : S extends ObjectSchema<infer F>
              ? { [K in keyof F]: Infer<F[K]> }
              : never

/** 描述的构造函数 */
export const s = {
  string: { kind: 'string' } as const,
  number: { kind: 'number' } as const,
  boolean: { kind: 'boolean' } as const,
  nullable: <O extends Schema>(of: O) => ({ kind: 'nullable', of }) as const,
  array: <O extends Schema>(of: O) => ({ kind: 'array', of }) as const,
  enum: <const V extends string>(
    name: string,
    values: readonly V[]
  ): EnumSchema<V> => ({ kind: 'enum', name, values }),
  object: <F extends Record<string, Schema>>(
    name: string,
    fields: F
  ): ObjectSchema<F> => ({ kind: 'object', name, fields }),
}
