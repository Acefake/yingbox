// Debug: run getPlayinfo step by step
const https = require('https')
const http = require('http')
const _cheerio = require('cheerio')
const _cryptojs = require('crypto-js')

function _fetch(url, options = {}) {
  if (!url || typeof url !== 'string') return Promise.reject(new Error(`Invalid URL: ${url}`))
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url)
    const mod = parsedUrl.protocol === 'https:' ? https : http
    const method = (options.method || 'GET').toUpperCase()
    const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', ...options.headers }
    const reqOptions = { hostname: parsedUrl.hostname, port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80), path: parsedUrl.pathname + parsedUrl.search, method, headers, timeout: options.timeout || 15000 }
    const req = mod.request(reqOptions, (res) => {
      const chunks = []
      if (res.headers['content-encoding'] === 'gzip' || res.headers['content-encoding'] === 'br') {
        const zlib = require('zlib')
        let stream = res
        if (res.headers['content-encoding'] === 'gzip') stream = res.pipe(zlib.createGunzip())
        else stream = res.pipe(zlib.createBrotliDecompress())
        stream.on('data', chunk => chunks.push(chunk))
        stream.on('end', () => { resolve({ data: Buffer.concat(chunks).toString('utf-8'), headers: res.headers }) })
        stream.on('error', reject)
      } else {
        res.on('data', chunk => chunks.push(chunk))
        res.on('end', () => { resolve({ data: Buffer.concat(chunks).toString('utf-8'), headers: res.headers }) })
      }
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')) })
    if (options.body && method === 'POST') req.write(options.body)
    req.end()
  })
}
const $fetch = function(url, options) { return _fetch(url, options) }
$fetch.get = function(url, options = {}) { return _fetch(url, options) }
$fetch.post = function(url, body, options = {}) { return _fetch(url, { ...options, method: 'POST', body }) }

async function main() {
  const jsUrl = 'https://ghp.xptvhelper.link/https://raw.githubusercontent.com/Yswag/xptv-extensions/refs/heads/main/js/cupfox.js'
  const { data: jsCode } = await $fetch(jsUrl)
  
  const sandbox = {
    $fetch, argsify: (e) => typeof e === 'string' ? JSON.parse(e) : (e || {}),
    jsonify: (o) => o, $print: (...a) => process.stderr.write(a.join(' ') + '\n'),
    createCheerio: () => _cheerio, createCryptoJS: () => _cryptojs,
    Buffer, console: { log: (...a) => process.stderr.write('[LOG] ' + a.join(' ') + '\n'), error: (...a) => process.stderr.write('[ERR] ' + a.join(' ') + '\n'), warn: (...a) => process.stderr.write('[WARN] ' + a.join(' ') + '\n') },
    setTimeout,
  }
  
  const fn = new Function(...Object.keys(sandbox), `"use strict";\n${jsCode}\nreturn { getConfig, getCards, getTracks, getPlayinfo, search };`)
  const api = fn(...Object.values(sandbox))
  
  const result = await api.getPlayinfo({ url: 'https://www.cupfox.ai/play/116811-1-1.html' })
  console.log(JSON.stringify(result, null, 2))
}

main().catch(e => console.error(e))
