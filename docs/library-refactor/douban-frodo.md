# 豆瓣 frodo 备用数据源

豆瓣请求默认走 `m.douban.com/rexxar/api/v2`（网页代理接口）。rexxar 失败或被风控时，同一个查询改走
`frodo.douban.com/api/v2`（豆瓣 Android 客户端接口）。两边的路径、参数和返回结构一致，调用方拿到的结果形状相同。

## 为什么做

- rexxar 会被风控：常见的是 403、418、302 到 `sec.douban.com` 验证页，以及「200 + 空列表」。
- 用到 rexxar 的两个地方，被拦后都没有备用：
  - 库外发现、在线首页的豆瓣浏览（`engine/online/douban-browse.ts`，`online.doubanBrowse`）；
  - 刮削后给本地片补类型（`main/library/providers/douban/douban-genres.ts`，由 `identify/genre-fill.ts` 调用）。
- frodo 是另一套入口，主机、鉴权和风控策略都和 rexxar 不同，匿名可读搜索、详情、探索列表、热门榜。

## 模块

代码在 `src/shared/douban/frodo/`（纯 Node，只用 `node:crypto`，不依赖 Electron；桌面端两个 utilityProcess
和独立服务共用）：

| 文件          | 内容                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------ |
| `sign.ts`     | apikey、secret、Android UA，`_sig` 签名                                                          |
| `client.ts`   | `frodoRequest(path, params, now)` 拼签名请求；`rexxarToFrodo(url, now)` 把 rexxar 地址换成 frodo |
| `map.ts`      | 搜索、列表、详情响应映射成 rexxar 结构（幂等，缓存不用区分来源）                                 |
| `fallback.ts` | `withFrodoFallback`：先 rexxar 后 frodo；`createSourceCooldown`：rexxar 出错后的冷却期           |
| `switch.ts`   | 开关 `YINGBOX_DOUBAN_FRODO`                                                                      |

模块只拼地址和请求头，不自己发请求。请求由调用方现有的传输层发出：

- 补类型：同一个低速 `ProviderHttp`（串行、2 秒一次、不重试），所以 rexxar 和 frodo 共用一个令牌桶；
  缓存键 `douban:genres:<kind>:<片名>#<年份>` 不变（provider_cache 表），frodo 的结果写在同一个键下。
- 豆瓣浏览：同一个 `NetClient`（SSRF 防护）、同一份 10 分钟页缓存（键仍是 rexxar 地址，也就是同一个查询）、
  同一个按主机熔断器（两个主机各自计数）。

## 签名

参考 MoviePilot `app/modules/douban/apiv2.py` 和 `CXP-shawn/frodo-douban-anon-probe-2026`（2026-04-21 实测）：

```
_sig = base64(HMAC-SHA1(secret, "GET&" + quote(path, safe="") + "&" + _ts))
```

- `path` 是 `/api/v2/...`，不含查询串；`/` 也要编码成 `%2F`。
- 查询参数加 `apikey=0dad551ec0f84ed02907ff5c42e8ec70`、`_ts`（秒级时间戳）、`_sig`；secret 是 `bf7dddc7c9cfe6f7`。
- `User-Agent` 必须是豆瓣 Android 客户端（`api-client/1 com.douban.frodo/...`），浏览器 UA 会返回 403 `invalid_apikey`；签名错误返回 400 `code 996`。
- MoviePilot 用 `YYYYMMDD` 作 `_ts`，服务端也接受。这里按探测报告用秒。

## 回退规则

- 触发：rexxar 抛错（HTTP 403 / 418 / 5xx、超时、网络错误、熔断中、返回的不是 JSON），或者返回空结果
  （补类型是搜索结果里没有影视条目；浏览是整页为空且没有下一页）。调用方自己取消时不回退。
- 两边都失败：抛 rexxar 的原错误，调用方的错误形态不变（补类型照旧「豆瓣补类型中止」并停下，浏览照旧报错）。
  rexxar 只是空结果时返回空结果。
- 缓存：开着回退时，rexxar 的空结果和 404 不进缓存（ttl 0），由 frodo 的结果写入同一个键。frodo 也为空时，
  按「查无此片」缓存 30 天。
- 冷却：补类型时 rexxar 出错后，10 分钟内直接走 frodo，不再先试 rexxar；冷却期内 frodo 也失败，就再试一次 rexxar。
  浏览靠现有的主机熔断，rexxar 连续 3 次失败后 10 分钟内不再请求。
- 日志：每次用到 frodo 都记一行，写明 rexxar 为什么没用上、frodo 的结果，例如
  `豆瓣补类型：rexxar 失败（HTTP 418），改走 frodo`。rexxar 正常时不记。

## 开关

- 默认开启。桌面端是常量 `DOUBAN_FRODO_DEFAULT = true`（`switch.ts`）。
- 独立服务 / NAS：环境变量 `YINGBOX_DOUBAN_FRODO=off` 关闭（`0` / `false` / `no` 也行），桌面端调试时也认这个变量。
  关闭后只走 rexxar，行为和接入 frodo 之前一样，空结果照旧缓存 30 天。

## 风险

- apikey 和 secret 是从豆瓣 Android 客户端里公开流传出来的，不是私钥。豆瓣随时可能吊销或者改签名算法。
  失效后 frodo 请求会报 400 / 403，回退会失败，但主路径 rexxar 不受影响，日志里会提示可以关掉开关。
- frodo 也有风控。高频请求可能被限流，所以必须走调用方原有的限速和缓存，不能另起一个快速通道。
- 用的是非官方接口，只做匿名只读，不登录、不写入。
- 只在 2026-10 从海外出口（AWS us-west-2）实测过；国内出口没测（见 ADR-0003：海外探测结果不作准）。

## 验证

- 单测：`tests/douban-frodo/frodo-core.test.ts`（签名与参考实现一致、映射、回退规则、开关），
  `tests/douban-frodo/frodo-wiring.test.ts`（浏览和补类型两条线的回退、缓存共用、令牌桶共用）。
- 手动：在开发环境里屏蔽 `m.douban.com`（比如 hosts 指向 127.0.0.1），打开在线首页的豆瓣卡片或者给新片刮削，
  日志里应该出现 `改走 frodo`，结果照常显示。设了 `YINGBOX_DOUBAN_FRODO=off` 后应该直接报错。
