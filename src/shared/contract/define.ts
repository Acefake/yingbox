/**
 * IPC 契约的类型工具。
 *
 * 契约是主进程注册、preload 代理、渲染层 `window.api` 类型三端的唯一来源：
 * - 通道名统一为「域名:键名」，由 {@link channelOf} 生成；
 * - 调用的参数元组由 `parse` 在主进程边界解析，`Args` 由 `call` 的泛型声明、`parse` 的返回值受其约束；
 * - 返回值与事件载荷只是类型（幻影字段），运行时不携带。
 *
 * 本文件被 sandboxed preload 打包引用，只能依赖纯 TS，不得 import 任何模块。
 */

/** 入参不符合契约。主进程注册器捕获后加上通道名再抛给渲染层。 */
export class ContractError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ContractError'
  }
}

/** 把渲染层传来的原始参数解析为 `Args`；非法时抛 {@link ContractError}。 */
export type ArgsParser<Args extends unknown[]> = (
  raw: readonly unknown[]
) => Args

/** 异步调用：渲染层 `invoke`，主进程 `handle`。 */
export interface Call<Args extends unknown[], Result> {
  readonly kind: 'call'
  readonly parse: ArgsParser<Args>
  /** 仅用于类型推导，运行时恒为 undefined */
  readonly result?: Result
}

/**
 * 同步调用：渲染层 `sendSync`，会阻塞渲染进程。
 * 只用于启动时必须在首屏前拿到的少量数据（如设置快照）。
 */
export interface SyncCall<Args extends unknown[], Result> {
  readonly kind: 'sync'
  readonly parse: ArgsParser<Args>
  /** 仅用于类型推导，运行时恒为 undefined */
  readonly result?: Result
}

/** 同步调用经 IPC 返回的外壳：sendSync 无法 reject，错误靠它带回 */
export type SyncReply =
  | { ok: true; value: unknown }
  | { ok: false; error: string }

/** 主进程推给渲染层的事件。渲染层得到 `on<Key>(cb)` 与 `off<Key>()` 两个方法。 */
export interface Event<Payload> {
  readonly kind: 'event'
  /** 仅用于类型推导，运行时恒为 undefined */
  readonly payload?: Payload
}

/* eslint-disable @typescript-eslint/no-explicit-any -- 下面是「任意契约」的上界，只用于约束泛型 */
export type AnyCall = Call<any, any> | SyncCall<any, any>
export type AnyEvent = Event<any>
/* eslint-enable @typescript-eslint/no-explicit-any */

/** 一个域：一组调用 + 一组事件，共享通道前缀。 */
export interface Domain<
  Name extends string = string,
  Calls extends Record<string, AnyCall> = Record<string, AnyCall>,
  Events extends Record<string, AnyEvent> = Record<string, AnyEvent>,
> {
  readonly name: Name
  readonly calls: Calls
  readonly events: Events
}

const noArgs = (): [] => []

/** 声明无参数的异步调用：`call<Result>()`。 */
export function call<Result = void>(): Call<[], Result>
/** 声明带参数的异步调用：`call<[path: string], Result>(a => [str(a[0], 'path')])`。 */
export function call<Args extends unknown[], Result>(
  parse: ArgsParser<Args>
): Call<Args, Result>
export function call(
  parse: ArgsParser<unknown[]> = noArgs
): Call<unknown[], unknown> {
  return { kind: 'call', parse }
}

/** 声明无参数的同步调用：`syncCall<Result>()`。 */
export function syncCall<Result>(): SyncCall<[], Result>
/** 声明带参数的同步调用。 */
export function syncCall<Args extends unknown[], Result>(
  parse: ArgsParser<Args>
): SyncCall<Args, Result>
export function syncCall(
  parse: ArgsParser<unknown[]> = noArgs
): SyncCall<unknown[], unknown> {
  return { kind: 'sync', parse }
}

/** 声明事件。 */
export function event<Payload>(): Event<Payload> {
  return { kind: 'event' }
}

/** 定义一个域。键名即方法名，也是通道名的后半段。 */
export function defineDomain<
  const Name extends string,
  Calls extends Record<string, AnyCall>,
  Events extends Record<string, AnyEvent> = Record<never, AnyEvent>,
>(name: Name, calls: Calls, events?: Events): Domain<Name, Calls, Events> {
  return { name, calls, events: events ?? ({} as Events) }
}

/** 通道名：「域名:键名」。调用与事件共用这一个规则。 */
export function channelOf(domain: string, key: string): string {
  return `${domain}:${key}`
}

/** 事件键对应的渲染层订阅 / 退订方法名：status → onStatus / offStatus */
export function listenerNames(key: string): { on: string; off: string } {
  const suffix = key.charAt(0).toUpperCase() + key.slice(1)
  return { on: `on${suffix}`, off: `off${suffix}` }
}

// ── 由契约推导渲染层 API 类型 ─────────────────────────────

type CallFn<C> =
  C extends Call<infer A, infer R>
    ? (...args: A) => Promise<Awaited<R>>
    : C extends SyncCall<infer A, infer R>
      ? (...args: A) => R
      : never

/** 调用的参数元组 */
export type ArgsOf<C> = C extends
  | Call<infer A, infer _R>
  | SyncCall<infer A, infer _R>
  ? A
  : never
/** 调用的返回值 */
export type ResultOf<C> = C extends
  | Call<infer _A, infer R>
  | SyncCall<infer _A, infer R>
  ? R
  : never
/** 事件的载荷 */
export type PayloadOf<E> = E extends Event<infer P> ? P : never

/** 一个域在渲染层的形状：`window.api.<域>` */
export type DomainApi<D extends Domain> = {
  [K in keyof D['calls']]: CallFn<D['calls'][K]>
} & {
  [K in keyof D['events'] & string as `on${Capitalize<K>}`]: (
    cb: (payload: PayloadOf<D['events'][K]>) => void
  ) => void
} & {
  [K in keyof D['events'] & string as `off${Capitalize<K>}`]: () => void
}

/** 全部域在渲染层的形状：`window.api` */
export type ApiOf<Ds extends Record<string, Domain>> = {
  [K in keyof Ds as Ds[K]['name']]: DomainApi<Ds[K]>
}

// ── 边界解析器：渲染层入参是 unknown，在这里收窄 ───────────────

function fail(name: string, expected: string): never {
  throw new ContractError(`参数 ${name} 应为${expected}`)
}

/** 非空以外不做限制的字符串 */
export function str(value: unknown, name: string): string {
  return typeof value === 'string' ? value : fail(name, '字符串')
}

/** 可选字符串：undefined / null 视为未传 */
export function optStr(value: unknown, name: string): string | undefined {
  return value == null ? undefined : str(value, name)
}

/** 有限数字 */
export function num(value: unknown, name: string): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : fail(name, '有限数字')
}

/** 安全整数 */
export function int(value: unknown, name: string): number {
  return Number.isSafeInteger(value) ? (value as number) : fail(name, '整数')
}

/** 布尔值 */
export function bool(value: unknown, name: string): boolean {
  return typeof value === 'boolean' ? value : fail(name, '布尔值')
}

/** 字面量之一 */
export function oneOf<const T extends readonly (string | number | boolean)[]>(
  value: unknown,
  name: string,
  options: T
): T[number] {
  return options.includes(value as T[number])
    ? (value as T[number])
    : fail(name, options.join(' / '))
}

/** 普通对象（只校验外形，字段由各模块自己的规范化函数处理） */
export function record<T extends object>(value: unknown, name: string): T {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as T)
    : fail(name, '对象')
}

/** 可选对象：undefined / null 视为未传 */
export function optRecord<T extends object>(
  value: unknown,
  name: string
): T | undefined {
  return value == null ? undefined : record<T>(value, name)
}

/** 可选数组（只校验外形） */
export function optArray<T>(value: unknown, name: string): T[] | undefined {
  if (value == null) return undefined
  return Array.isArray(value) ? (value as T[]) : fail(name, '数组')
}

/** 字符串数组 */
export function strs(values: readonly unknown[], name: string): string[] {
  return values.map((value, index) => str(value, `${name}[${index}]`))
}
