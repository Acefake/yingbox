const https = require('https')
const cheerio = require('cheerio')
const url = 'https://www.novipnoad.net/page/1/?s=%E6%96%97%E7%A0%B4'
https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X)' } }, r => {
  let d = ''
  r.on('data', c => d += c)
  r.on('end', () => {
    const $ = cheerio.load(d)
    console.log('video-item len:', $('.video-item').length)
    console.log('search-listing len:', $('.search-listing-content').length)
    console.log('video-listing len:', $('.video-listing-content').length)
    const items = $('.video-listing-content .video-item')
    console.log('video-listing-content video-item:', items.length)
    if (items.length > 0) {
      const first = items.eq(0)
      console.log('name:', first.find('.item-thumbnail a').attr('title'))
      console.log('href:', first.find('.item-thumbnail a').attr('href'))
    }
    // Try search-listing
    const sitems = $('.search-listing-content .video-item')
    console.log('search-listing video-item:', sitems.length)
  })
})
