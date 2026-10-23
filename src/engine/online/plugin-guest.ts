/** QuickJS 内的桥接代码：跨边界只传 JSON；宿主对象使用不透明编号。 */
export const PLUGIN_GUEST = String.raw`
(() => {
  const callHost = globalThis.__hostCall;
  delete globalThis.__hostCall;
  const refs = new WeakMap();
  const callbacks = new Map();
  const proxies = new Map();
  let nextCallback = 0;
  function encode(value) {
    if (refs.has(Object(value))) return { t: 'ref', id: refs.get(value) };
    if (typeof value === 'function') {
      const id = ++nextCallback;
      callbacks.set(id, value);
      return { t: 'callback', id };
    }
    if (value === undefined) return { t: 'undefined' };
    if (value === null || typeof value !== 'object') return { t: 'value', value };
    if (Array.isArray(value)) return { t: 'array', value: value.map(encode) };
    return { t: 'object', value: Object.fromEntries(Object.keys(value).map(k => [k, encode(value[k])])) };
  }
  function request(op, id, extra = {}) {
    const result = callHost(JSON.stringify({ op, id, ...extra }));
    const unpack = text => {
      const reply = JSON.parse(text);
      if (reply.error) throw new Error(reply.error);
      return decode(reply.value);
    };
    return result instanceof Promise ? result.then(unpack) : unpack(result);
  }
  function decode(value) {
    if (value.t === 'undefined') return undefined;
    if (value.t === 'value') return value.value;
    if (value.t === 'array') return value.value.map(decode);
    if (value.t === 'object') return Object.fromEntries(Object.entries(value.value).map(([k,v]) => [k,decode(v)]));
    const id = value.id;
    if (proxies.has(id)) return proxies.get(id);
    const target = value.callable ? function() {} : {};
    const proxy = new Proxy(target, {
      get(_target, key) {
        if (typeof key === 'symbol') return undefined;
        return request('get', id, { key });
      },
      set(_target, key, v) {
        request('set', id, { key, value: encode(v) }); return true;
      },
      apply(_target, _this, args) { return request('call', id, { args: args.map(encode) }); },
      construct(_target, args) { return request('construct', id, { args: args.map(encode) }); },
      ownKeys() { return [...new Set([...Reflect.ownKeys(target), ...request('keys', id)])]; },
      getOwnPropertyDescriptor(_target, key) {
        const own = Reflect.getOwnPropertyDescriptor(target, key);
        return own && !own.configurable ? own : { enumerable: true, configurable: true };
      }
    });
    refs.set(proxy, id);
    proxies.set(id, proxy);
    return proxy;
  }
  globalThis.__invokeCallback = (id, args, receiver) => JSON.stringify(encode(callbacks.get(id).apply(decode(JSON.parse(receiver)), JSON.parse(args).map(decode))));
  globalThis.__install = text => {
    const values = JSON.parse(text);
    for (const [key, value] of Object.entries(values)) globalThis[key] = decode(value);
    delete globalThis.__install;
  };
  globalThis.__resultJSON = value => JSON.stringify(value) ?? 'null';
})();
`
