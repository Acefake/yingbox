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
  // simplified POST support
  return _fetch(url, { ...options, method: 'POST', body })
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

// ── Download JS file ───────────────────────────────────────
async function downloadJS(url) {
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
    const ext = argsify(extJson)

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
          result = await api.search(ext)
        } else {
          result = { success: false, error: 'search function not found in JS' }
        }
        break
      case 'getCards':
        if (typeof api.getCards === 'function') {
          result = await api.getCards(ext)
        } else {
          result = { success: false, error: 'getCards function not found in JS' }
        }
        break
      case 'getTracks':
        if (typeof api.getTracks === 'function') {
          result = await api.getTracks(ext)
        } else {
          result = { success: false, error: 'getTracks function not found in JS' }
        }
        break
      case 'getPlayinfo':
        if (typeof api.getPlayinfo === 'function') {
          result = await api.getPlayinfo(ext)
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

    console.log(JSON.stringify({ success: true, data: result }, null, 0))
  } catch (error) {
    console.log(JSON.stringify({ success: false, error: error.message, stack: error.stack?.split('\n')[0] }))
  }
}

main()
