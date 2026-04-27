const https = require('https')
const fs = require('fs')
const url = 'https://www.novipnoad.net/page/1/?s=%E6%96%97%E7%A0%B4'
https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X)' } }, r => {
  let d = ''
  r.on('data', c => d += c)
  r.on('end', () => {
    fs.writeFileSync('test_search.html', d)
    // Find class names with 'video' or 'item' or 'search'
    const cheerio = require('cheerio')
    const $ = cheerio.load(d)
    // List all div/section/article class names
    const classes = new Set()
    $('[class]').each((_, el) => {
      const cls = $(el).attr('class') || ''
      cls.split(/\s+/).forEach(c => {
        if (c.includes('video') || c.includes('item') || c.includes('search') || c.includes('listing') || c.includes('card') || c.includes('post')) {
          classes.add(c)
        }
      })
    })
    console.log('Relevant classes:', [...classes].join(', '))
  })
})
