/**
 * Torznab 响应样例：按 Torznab 规范与 Jackett / Prowlarr 的公开输出整理的字段形状（不含真实站点数据），
 * 和一个最小的 v1 种子文件（bencode 手写）。
 */

const HASH_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
export const HASH_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
export { HASH_A }

/** Jackett 聚合接口的一页结果：magneturl、只有 infohash、只有 .torrent 下载地址三种 */
export const JACKETT_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="1.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:torznab="http://torznab.com/schemas/2015/feed">
  <channel>
    <atom:link href="http://nas:9117/api" rel="self" type="application/rss+xml" />
    <title>AggregateSearch</title>
    <description>This feed includes all configured trackers</description>
    <item>
      <title>Example.Movie.2024.2160p.WEB-DL.DV.HDR.DDP5.1.Atmos-GRP</title>
      <guid>http://nas:9117/dl/tracker1/?jackett_apikey=KEY&amp;path=abc</guid>
      <jackettindexer id="tracker1">Tracker One</jackettindexer>
      <link>http://nas:9117/dl/tracker1/?jackett_apikey=KEY&amp;path=abc</link>
      <pubDate>Mon, 20 Oct 2026 12:00:00 +0000</pubDate>
      <size>16106127360</size>
      <enclosure url="http://nas:9117/dl/tracker1/?jackett_apikey=KEY&amp;path=abc" length="16106127360" type="application/x-bittorrent" />
      <torznab:attr name="category" value="2000" />
      <torznab:attr name="seeders" value="120" />
      <torznab:attr name="peers" value="150" />
      <torznab:attr name="magneturl" value="magnet:?xt=urn:btih:${HASH_A}&amp;dn=Example.Movie" />
    </item>
    <item>
      <title><![CDATA[示例电影 2024 1080p 中字]]></title>
      <jackettindexer id="tracker2">Tracker Two</jackettindexer>
      <link>http://nas:9117/dl/tracker2/?jackett_apikey=KEY&amp;path=def</link>
      <pubDate>Sun, 19 Oct 2026 08:30:00 +0000</pubDate>
      <torznab:attr name="size" value="4294967296" />
      <torznab:attr name="seeders" value="8" />
      <torznab:attr name="infohash" value="${HASH_B.toUpperCase()}" />
    </item>
    <item>
      <title>Example.Movie.2024.720p</title>
      <jackettindexer id="tracker3">Tracker Three</jackettindexer>
      <link>http://nas:9117/dl/tracker3/?jackett_apikey=KEY&amp;path=ghi</link>
      <size>1073741824</size>
      <torznab:attr name="seeders" value="3" />
    </item>
    <item>
      <title>Elsewhere.Release</title>
      <link>http://other-host:9117/dl/x</link>
      <torznab:attr name="seeders" value="99" />
    </item>
  </channel>
</rss>`

/** Prowlarr 单个索引器：magnet 在 link 里 */
export const PROWLARR_RSS = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed">
  <channel>
    <title>Prowlarr Indexer</title>
    <item>
      <title>Example.Movie.2024.2160p.REMUX</title>
      <prowlarrindexer id="3" type="public">Public Tracker</prowlarrindexer>
      <link>magnet:?xt=urn:btih:${HASH_A}&amp;dn=Example.Movie.2024.2160p.REMUX</link>
      <size>60000000000</size>
      <torznab:attr name="seeders" value="200" />
      <torznab:attr name="peers" value="210" />
    </item>
  </channel>
</rss>`

/** 错误响应 */
export const ERROR_KEY = `<?xml version="1.0" encoding="UTF-8"?>
<error code="100" description="Invalid API Key" />`
export const ERROR_NO_FUNCTION = `<?xml version="1.0" encoding="UTF-8"?>
<error code="203" description="Function Not Available: movie search not supported" />`

/** t=caps */
export const CAPS = `<?xml version="1.0" encoding="UTF-8"?>
<caps>
  <server title="Jackett" />
  <searching>
    <search available="yes" supportedParams="q" />
    <tv-search available="yes" supportedParams="q,season,ep,imdbid" />
    <movie-search available="yes" supportedParams="q,imdbid" />
  </searching>
</caps>`

/** 最小 v1 种子：announce + info{length,name,piece length,pieces} */
export function tinyTorrent(): Uint8Array {
  const info = `d6:lengthi1024e4:name8:demo.mkv12:piece lengthi16384e6:pieces20:${'x'.repeat(
    20
  )}e`
  const body = `d8:announce30:udp://tracker.example.org:13374:info${info}e`
  return new TextEncoder().encode(body)
}
/** 上面种子 info 字典原文（测试里算 SHA-1 对照） */
export const TINY_INFO = `d6:lengthi1024e4:name8:demo.mkv12:piece lengthi16384e6:pieces20:${'x'.repeat(
  20
)}e`
