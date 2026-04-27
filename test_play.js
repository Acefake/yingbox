const https = require('https')
const url = 'https://www.cupfox.ai/play/116811-1-1.html'
https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X)', 'Referer': 'https://www.cupfox.ai/' } }, r => {
  let d = ''
  r.on('data', c => d += c)
  r.on('end', () => {
    console.log('status:', r.statusCode)
    console.log('len:', d.length)
    console.log('has player_aaaa:', d.includes('player_aaaa'))
    console.log('has iframe:', d.includes('iframe'))
    console.log('has foxplay:', d.includes('foxplay'))
    // Find player_aaaa context
    const idx = d.indexOf('player_aaaa')
    if (idx > -1) {
      console.log('player_aaaa context:', d.substring(idx, idx + 200))
    }
    // Find iframe
    const iidx = d.indexOf('iframe')
    if (iidx > -1) {
      console.log('iframe context:', d.substring(iidx, iidx + 300))
    }
  })
})
