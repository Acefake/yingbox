const https = require('https')
const http = require('http')
const _cheerio = require('cheerio')
const _cryptojs = require('crypto-js')

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
      if (res.headers['content-encoding'] === 'gzip' || res.headers['content-encoding'] === 'br') {
        const zlib = require('zlib')
        let stream = res
        if (res.headers['content-encoding'] === 'gzip') stream = res.pipe(zlib.createGunzip())
        else stream = res.pipe(zlib.createBrotliDecompress())
        stream.on('data', chunk => chunks.push(chunk))
        stream.on('end', () => { const data = Buffer.concat(chunks).toString('utf-8'); resolve({ data, headers: res.headers }) })
        stream.on('error', reject)
      } else {
        res.on('data', chunk => chunks.push(chunk))
        res.on('end', () => { const data = Buffer.concat(chunks).toString('utf-8'); resolve({ data, headers: res.headers }) })
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

// Test getPlayinfo manually
async function test() {
  const url = 'https://www.cupfox.ai/play/116811-1-1.html'
  const SITE = 'https://www.cupfox.ai'
  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X)'

  // Fetch play page
  const resp = await $fetch.get(url, {
    headers: { 'User-Agent': UA, Referer: SITE + '/' }
  })
  const html = resp.data
  console.log('html len:', html.length)
  console.log('has player_aaaa:', html.includes('player_aaaa'))

  // Extract player_aaaa
  const idx = html.indexOf('player_aaaa')
  if (idx > -1) {
    const braceStart = html.indexOf('{', idx)
    let depth = 0
    let braceEnd = -1
    for (let i = braceStart; i < html.length && i < braceStart + 5000; i++) {
      if (html[i] === '{') depth++
      if (html[i] === '}') depth--
      if (depth === 0) { braceEnd = i; break }
    }
    if (braceEnd > braceStart) {
      const playerData = JSON.parse(html.substring(braceStart, braceEnd + 1))
      console.log('player url:', playerData.url)
      console.log('player from:', playerData.from)

      // Try foxplay API
      const vid = playerData.url
      const encodedVid = encodeURIComponent(vid)
      console.log('encoded vid:', encodedVid.substring(0, 80))

      const apiResp = await $fetch.post(`${SITE}/foxplay/api.php`, `vid=${encodedVid}`, {
        headers: {
          'User-Agent': UA,
          Referer: `${SITE}/foxplay/muiplayer.php?vid=${encodedVid}`,
          Origin: SITE,
          'X-Requested-With': 'XMLHttpRequest',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      })
      console.log('api resp:', apiResp.data.substring(0, 500))
    }
  }
}

test().catch(e => console.error(e))
