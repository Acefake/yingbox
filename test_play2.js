const https = require('https')
const url = 'https://www.cupfox.ai/play/116811-1-1.html'
https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X)', 'Referer': 'https://www.cupfox.ai/' } }, r => {
  let d = ''
  r.on('data', c => d += c)
  r.on('end', () => {
    const idx = d.indexOf('player_aaaa=')
    if (idx > -1) {
      // Find the value after player_aaaa=
      const start = d.indexOf('{', idx)
      let depth = 0
      let braceEnd = -1
      for (let i = start; i < d.length && i < start + 10000; i++) {
        if (d[i] === '{') depth++
        if (d[i] === '}') depth--
        if (depth === 0) { braceEnd = i; break }
      }
      if (braceEnd > start) {
        const json = d.substring(start, braceEnd + 1)
        const obj = JSON.parse(json)
        console.log('url:', obj.url)
        console.log('keys:', Object.keys(obj).join(', '))
      }
    }
  })
})
