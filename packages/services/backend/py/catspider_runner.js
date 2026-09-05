/**
 * CatSpider Protocol Runner
 * Provides runtime environment for CatSpider JS plugins
 * Usage: node catspider_runner.js <js_url> <action> [ext_json]
 *   action: search | getCards | getTracks | getPlayinfo
 *   ext_json: JSON string passed to the action function
 */

const https = require('https')
const http = require('http')
const _cheerio = require('cheerio')
const _cryptojs = require('crypto-js')

// ── HTTP fetch helper ──────────────────────────────────────
function _fetch(url, options = {}) {
  if (!url || typeof url !== 'string') {
    return Promise.reject(new Error(`Invalid URL: ${url}`))
  }
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url)
    const mod = parsedUrl.protocol === 'https:' ? https : http
    const method = (options.method || 'GET').toUpperCase()
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      ...options.headers,
    }

    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      headers,
      timeout: options.timeout || 15000,
    }

    const req = mod.request(reqOptions, (res) => {
      const chunks = []
      // Handle gzip/br
      if (res.headers['content-encoding'] === 'gzip' || res.headers['content-encoding'] === 'br') {
        const zlib = require('zlib')
        let stream = res
        if (res.headers['content-encoding'] === 'gzip') {
          stream = res.pipe(zlib.createGunzip())
        } else {
          stream = res.pipe(zlib.createBrotliDecompress())
        }
        stream.on('data', chunk => chunks.push(chunk))
        stream.on('end', () => {
          const data = Buffer.concat(chunks).toString('utf-8')
          resolve({ data, headers: res.headers })
        })
        stream.on('error', reject)
      } else {
        res.on('data', chunk => chunks.push(chunk))
        res.on('end', () => {
          const data = Buffer.concat(chunks).toString('utf-8')
          resolve({ data, headers: res.headers })
        })
      }
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')) })

    // Write body for POST
    if (options.body && method === 'POST') {
      req.write(options.body)
    }
    req.end()
  })
}

// CatSpider JS files use $fetch.get(url, { headers }) pattern
const $fetch = function(url, options) {
  return _fetch(url, options)
}
$fetch.get = function(url, options = {}) {
  return _fetch(url, options)
}
$fetch.post = function(url, body, options = {}) {
  // 插件既有传字符串，也有传对象的实现；Node 的 req.write 不接受普通对象。
  let payload = body
  if (payload && typeof payload === 'object' && !Buffer.isBuffer(payload)) {
    const contentType = String(options.headers?.['Content-Type'] || options.headers?.['content-type'] || '')
    payload = contentType.includes('json')
      ? JSON.stringify(payload)
      : new URLSearchParams(payload).toString()
  }
  return _fetch(url, { ...options, method: 'POST', body: payload })
}

// XPTV 旧插件依赖宿主注入的配置字符串和 JSEncrypt。使用 Node 原生 RSA
// 实现最小兼容接口，避免为每个插件单独改写加解密逻辑。
function loadJSEncrypt() {
  const crypto = require('crypto')
  return class JSEncryptCompat {
    setPrivateKey(key) { this.privateKey = key }
    decrypt(value) {
      if (!this.privateKey || !value) return null
      try {
        return crypto.privateDecrypt(
          { key: this.privateKey, padding: crypto.constants.RSA_PKCS1_PADDING },
          Buffer.from(String(value), 'base64'),
        ).toString('utf8')
      } catch {
        return null
      }
    }
  }
}

// ── CatSpider runtime helpers ──────────────────────────────
function argsify(ext) {
  if (typeof ext === 'string') {
    try { return JSON.parse(ext) } catch { return {} }
  }
  return ext || {}
}

function jsonify(obj) {
  return obj
}

function $print(...args) {
  // Debug output - write to stderr so it doesn't interfere with JSON output
  process.stderr.write(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') + '\n')
}

function createCheerio() {
  return _cheerio
}

function createCryptoJS() {
  return _cryptojs
}

// 不同版本的 XPTV 插件对搜索词字段命名不一致（keyword/text/wd）。
// 在运行时补齐别名，保持插件源码无需逐个改动。
function normalizeActionExt(ext) {
  const value = argsify(ext)
  if (!value || typeof value !== 'object') return {}
  const query = value.keyword || value.text || value.wd || ''
  return { ...value, keyword: value.keyword || query, text: value.text || query, wd: value.wd || query }
}

// XPTV 部分旧插件依赖 $html 的简化选择器 API，而另一些使用 cheerio。
// 两种写法共用同一个解析内核，避免因运行时缺失直接失败。
function _select(root, selector) {
  const $ = _cheerio.load(root)
  return selector ? $(selector) : $.root()
}
const $html = {
  elements(html, selector) {
    return _select(html, selector).toArray()
  },
  text(root, selector) {
    if (typeof root === 'string') return _select(root, selector).text().trim()
    const $ = _cheerio.load(root)
    return (selector ? $(root).find(selector) : $(root)).text().trim()
  },
  attr(root, selector, name) {
    if (typeof root === 'string') return _select(root, selector).attr(name) || ''
    const $ = _cheerio.load(root)
    return (selector ? $(root).find(selector).first() : $(root)).attr(name) || ''
  },
}

// 每次调用都是独立 Node 进程。这里至少保证依赖缓存的插件能完成本次解析；
// 不持久化站点令牌，避免将敏感凭据写入临时目录。
const cacheStore = new Map()
const $cache = {
  get: key => cacheStore.get(key),
  set: (key, value) => cacheStore.set(key, value),
  remove: key => cacheStore.delete(key),
}
const $utils = {
  toastInfo: message => $print('[info]', message),
  toastError: message => $print('[error]', message),
  openSafari: (url, userAgent) => $fetch.get(url, { headers: userAgent ? { 'User-Agent': userAgent } : {} }),
}

function normalizePluginResult(value) {
  let result = value
  // 部分插件沿用 TVBox API，直接 return JSON.stringify({...})。
  // 最多解两层，兼容被二次序列化的数据同时避免意外递归。
  for (let i = 0; i < 2 && typeof result === 'string'; i++) {
    try {
      result = JSON.parse(result)
    } catch {
      break
    }
  }
  return result
}

// ── Download JS file ───────────────────────────────────────
async function downloadJS(url) {
  if (url.startsWith('file://') || url.startsWith('/') || /^[A-Za-z]:[\\\/]/.test(url)) {
    const fs = require('fs')
    const localPath = url.startsWith('file://') ? url.replace(/^file:\/\//, '').replace(/\//g, require('path').sep) : url
    return fs.readFileSync(localPath, 'utf-8')
  }
  const { data } = await $fetch(url)
  return data
}

// ── Main ───────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2)
  if (args.length < 2) {
    console.log(JSON.stringify({ success: false, error: 'Usage: node catspider_runner.js <js_url> <action> [ext_json]' }))
    process.exit(1)
  }

  const jsUrl = args[0]
  const action = args[1]
  const extJson = args[2] || '{}'

  try {
    // Download JS file
    const jsCode = await downloadJS(jsUrl)

    // Create sandboxed execution context
    const sandbox = {
      $fetch,
      argsify,
      jsonify,
      $print,
      createCheerio,
      createCryptoJS,
      $html,
      $cache,
      $utils,
      $config_str: extJson,
      loadJSEncrypt,
      Buffer,
      console: { log: $print, error: $print, warn: $print },
      setTimeout,
    }

    // Execute JS in sandbox context - cheerio is created via createCheerio() inside the JS
    const fn = new Function(
      ...Object.keys(sandbox),
      `"use strict";\n${jsCode}\nreturn { getConfig, getCards, getTracks, getPlayinfo, search };`
    )
    const api = fn(...Object.values(sandbox))

    // Call the requested action
    let result
    const ext = normalizeActionExt(extJson)
    // Some plugins use JSON.parse(ext) directly, so also provide a normalized JSON string
    const extStr = typeof extJson === 'string' ? extJson : JSON.stringify(ext)

    try {
      switch (action) {
        case 'getConfig':
          if (typeof api.getConfig === 'function') {
            result = await api.getConfig()
          } else {
            result = { success: false, error: 'getConfig function not found in JS' }
          }
          break
      case 'search':
        if (typeof api.search === 'function') {
          result = await api.search(JSON.stringify(ext))
        } else {
          result = { success: false, error: 'search function not found in JS' }
        }
        break
      case 'getCards':
        if (typeof api.getCards === 'function') {
          result = await api.getCards(extStr)
        } else {
          result = { success: false, error: 'getCards function not found in JS' }
        }
        break
      case 'getTracks':
        if (typeof api.getTracks === 'function') {
          result = await api.getTracks(extStr)
        } else {
          result = { success: false, error: 'getTracks function not found in JS' }
        }
        break
      case 'getPlayinfo':
        if (typeof api.getPlayinfo === 'function') {
          result = await api.getPlayinfo(extStr)
        } else {
          result = { success: false, error: 'getPlayinfo function not found in JS' }
        }
        break
      default:
        result = { success: false, error: `Unknown action: ${action}` }
    }
    } catch (innerErr) {
      result = { success: false, error: innerErr.message, stack: innerErr.stack?.split('\n')[0] }
    }

    console.log(JSON.stringify({ success: true, data: normalizePluginResult(result) }, null, 0))
  } catch (error) {
    console.log(JSON.stringify({ success: false, error: error.message, stack: error.stack?.split('\n')[0] }))
  }
}

main()
