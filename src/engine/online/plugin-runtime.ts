/** 独立 WASM JavaScript 堆；插件无法得到 Node 对象、模块加载器或原生网络入口。 */
import {
  type QuickJSContext,
  type QuickJSHandle,
  getQuickJS,
} from 'quickjs-emscripten'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { lazyModule } from '../../shared/html/cheerio'
import { PLUGIN_GUEST } from './plugin-guest'

const cryptoSource = lazyModule(() =>
  readFileSync(
    createRequire(__filename).resolve('crypto-js/crypto-js.js'),
    'utf8'
  )
)

interface Wire {
  t: string
  value?: unknown
  id?: number
  callable?: boolean
}
interface HostRef {
  value: object
  receiver?: object
}
const FORBIDDEN = new Set([
  'constructor',
  '__proto__',
  'prototype',
  'caller',
  'callee',
  'arguments',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
])
const MAX_TRANSFER = 16 * 1024 * 1024

/** 每次动作拥有独立堆；脚本与 Promise 微任务共享总执行期限。 */
export async function runPlugin(
  code: string,
  globals: Record<string, unknown>,
  action: string,
  argument: string | undefined,
  timeoutMs = 30_000
): Promise<unknown> {
  const engine = await getQuickJS()
  const vm = engine.newContext()
  const deadline = Date.now() + timeoutMs
  vm.runtime.setMemoryLimit(128 * 1024 * 1024)
  vm.runtime.setMaxStackSize(512 * 1024)
  vm.runtime.setInterruptHandler(() => Date.now() >= deadline)
  const timers = new Set<ReturnType<typeof setTimeout>>()
  let hostBytes = 0
  const measured = new WeakSet<object>()
  const identities = new WeakMap<object, Map<object | undefined, number>>()
  let failure: unknown
  const refs = new Map<number, HostRef>()
  const deferred = new Set<ReturnType<QuickJSContext['newPromise']>>()
  let alive = true
  let timer: ReturnType<typeof setTimeout> | undefined
  let wake: (() => void) | undefined
  const signal = (): void => {
    wake?.()
    wake = undefined
  }
  const store = (value: object, receiver?: object): Wire => {
    const known = identities.get(value)?.get(receiver)
    if (known)
      return { t: 'ref', id: known, callable: typeof value === 'function' }
    if (ArrayBuffer.isView(value) && !measured.has(value)) {
      hostBytes += value.byteLength
      measured.add(value)
      if (hostBytes > 32 * 1024 * 1024)
        throw new Error('插件宿主缓冲区用量超限')
    }
    if (refs.size >= 50_000) throw new Error('插件宿主对象数量超限')
    const id = refs.size + 1
    refs.set(id, { value, receiver })
    const receivers =
      identities.get(value) ?? new Map<object | undefined, number>()
    receivers.set(receiver, id)
    identities.set(value, receivers)
    return { t: 'ref', id, callable: typeof value === 'function' }
  }
  const encode = (value: unknown): Wire => {
    if (value === undefined) return { t: 'undefined' }
    if (Array.isArray(value)) return { t: 'array', value: value.map(encode) }
    if (
      value !== null &&
      (typeof value === 'object' || typeof value === 'function')
    )
      return store(value)
    return { t: 'value', value }
  }
  const evaluate = (text: string): QuickJSHandle =>
    vm.unwrapResult(vm.evalCode(text))
  const callback = (
    id: number,
    args: unknown[],
    receiver: unknown
  ): unknown => {
    if (!alive) throw new Error('插件执行已结束')
    const encoded = JSON.stringify(args.map(encode))
    const result = evaluate(
      `__invokeCallback(${id}, ${JSON.stringify(encoded)}, ${JSON.stringify(JSON.stringify(encode(receiver)))})`
    )
    try {
      return decode(JSON.parse(vm.getString(result)) as Wire)
    } finally {
      result.dispose()
    }
  }
  const decode = (wire: Wire): unknown => {
    switch (wire.t) {
      case 'undefined':
        return undefined
      case 'value':
        return wire.value
      case 'ref': {
        const ref = refs.get(wire.id!)
        if (!ref) throw new Error('无效的插件对象')
        return ref.value
      }
      case 'callback':
        return function (this: unknown, ...args: unknown[]) {
          return callback(wire.id!, args, this)
        }
      case 'array':
        return (wire.value as Wire[]).map(decode)
      case 'object':
        return Object.fromEntries(
          Object.entries(wire.value as Record<string, Wire>).map(([k, v]) => [
            k,
            decode(v),
          ])
        )
      default:
        throw new Error('无效的插件参数')
    }
  }
  const reply = (value: unknown, error?: unknown): string => {
    const text = JSON.stringify(
      error
        ? { error: error instanceof Error ? error.message : String(error) }
        : { value: encode(value) }
    )
    if (text.length > MAX_TRANSFER) throw new Error('插件传输内容过大')
    return text
  }
  const dispatch = (text: string): unknown => {
    if (hostBytes > 32 * 1024 * 1024) throw new Error('插件宿主缓冲区用量超限')
    if (text.length > MAX_TRANSFER) throw new Error('插件参数过大')
    const request = JSON.parse(text) as {
      id: number
      op: string
      key: string
      args?: Wire[]
      value: Wire
    }
    const ref = refs.get(request.id)
    if (!ref) throw new Error('无效的插件对象')
    const args = request.args?.map(decode) ?? []
    if (
      FORBIDDEN.has(request.key) ||
      (typeof ref.value === 'function' &&
        ['call', 'apply', 'bind'].includes(request.key)) ||
      (ArrayBuffer.isView(ref.value) &&
        ['buffer', 'parent', 'offset', 'byteOffset'].includes(request.key))
    ) {
      throw new Error('不允许访问宿主原型或重绑定宿主方法')
    }
    switch (request.op) {
      case 'get': {
        const value = Reflect.get(ref.value, request.key)
        return typeof value === 'function'
          ? { method: value, receiver: ref.value }
          : { property: value }
      }
      case 'set':
        return Reflect.set(ref.value, request.key, decode(request.value))
      case 'keys':
        return Object.keys(ref.value).filter(key => !FORBIDDEN.has(key))
      case 'call':
        return Reflect.apply(
          ref.value as (...args: unknown[]) => unknown,
          ref.receiver,
          args
        )
      case 'construct':
        return Reflect.construct(
          ref.value as new (...args: unknown[]) => object,
          args
        )
      default:
        throw new Error('不支持的插件操作')
    }
  }
  const bridge = vm.newFunction('hostCall', input => {
    try {
      const text = vm.getString(input)
      const value = dispatch(text)
      const { op } = JSON.parse(text) as { op: string }
      if (op === 'get') {
        const property = value as {
          method?: object
          receiver?: object
          property?: unknown
        }
        const wire = property.method
          ? store(property.method, property.receiver)
          : encode(property.property)
        const text = JSON.stringify({ value: wire })
        if (text.length > MAX_TRANSFER) throw new Error('插件传输内容过大')
        return vm.newString(text)
      }
      if (value instanceof Promise) {
        const promise = vm.newPromise()
        deferred.add(promise)
        const settle = (value: unknown, error?: unknown): void => {
          if (!alive) return
          let handle: QuickJSHandle | undefined
          try {
            let text: string
            try {
              text = reply(value, error)
            } catch (error) {
              text = reply(undefined, error)
            }
            handle = vm.newString(text)
            promise.resolve(handle)
          } catch (error) {
            failure = error
          } finally {
            handle?.dispose()
            signal()
          }
        }
        void value.then(
          value => settle(value),
          error => settle(undefined, error)
        )
        return promise.handle
      }
      return vm.newString(reply(value))
    } catch (error) {
      return vm.newString(reply(undefined, error))
    }
  })
  vm.setProp(vm.global, '__hostCall', bridge)
  bridge.dispose()
  let result: QuickJSHandle | undefined
  try {
    evaluate(PLUGIN_GUEST).dispose()
    globals = {
      ...globals,
      __randomBytes: (size: number) => {
        if (!Number.isSafeInteger(size) || size < 0 || size > 65536)
          throw new Error('随机字节数量超限')
        return Array.from(randomBytes(size))
      },
      setTimeout: (fn: () => void, ms = 0) => {
        if (timers.size >= 1000) throw new Error('插件定时器数量超限')
        const id = setTimeout(
          () => {
            timers.delete(id)
            if (alive) {
              try {
                fn()
              } catch {
                /* 期限由总执行计时器处理 */
              }
              signal()
            }
          },
          Math.max(0, Math.min(Number(ms) || 0, timeoutMs))
        )
        timers.add(id)
        return Number(id)
      },
      clearTimeout: (id: number) => {
        for (const timer of timers)
          if (Number(timer) === id) {
            clearTimeout(timer)
            timers.delete(timer)
          }
      },
    }
    evaluate(
      `__install(${JSON.stringify(JSON.stringify(Object.fromEntries(Object.entries(globals).map(([k, v]) => [k, encode(v)]))))})`
    ).dispose()
    evaluate(`{
      const random = globalThis.__randomBytes; delete globalThis.__randomBytes;
      globalThis.crypto = { getRandomValues(array) {
        const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
        bytes.set(random(bytes.length)); return array;
      } };
    }`).dispose()
    evaluate(cryptoSource()).dispose()
    evaluate('globalThis.createCryptoJS = () => globalThis.CryptoJS').dispose()
    // 顶层初始化、动作调用、结果序列化都在解释器内执行。
    const source = `${code}\n;Promise.resolve(typeof ${action} === 'function' ? ${action}(${argument === undefined ? '' : JSON.stringify(argument)}) : {success:false,error:${JSON.stringify(`${action} function not found in JS`)}}).then(__resultJSON)`
    result = evaluate(source)
    timer = setTimeout(signal, Math.max(1, deadline - Date.now() + 1))
    for (;;) {
      if (failure) throw failure
      if (Date.now() >= deadline) throw new Error('插件执行超时')
      const jobs = vm.runtime.executePendingJobs()
      if (jobs.error) {
        const error = vm.dump(jobs.error)
        jobs.error.dispose()
        throw new Error(String(error?.message ?? error))
      }
      const state = vm.getPromiseState(result)
      if (state.type === 'fulfilled') {
        try {
          const text = vm.getString(state.value)
          if (text.length > MAX_TRANSFER) throw new Error('插件结果过大')
          return text === undefined ? undefined : JSON.parse(text)
        } finally {
          state.value.dispose()
        }
      }
      if (state.type === 'rejected') {
        const error = vm.dump(state.error)
        state.error.dispose()
        throw new Error(String(error?.message ?? error))
      }
      await new Promise<void>(resolve => {
        wake = resolve
      })
    }
  } finally {
    alive = false
    clearTimeout(timer)
    for (const timer of timers) clearTimeout(timer)
    result?.dispose()
    for (const promise of deferred) promise.dispose()
    vm.dispose()
  }
}
