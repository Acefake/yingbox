# ADR-0002 不引入 impit 伪装 TLS 指纹

- 状态：已采纳（2026-10-22）
- 相关：在线插件源优化第 1 项（未开 PR）

## 背景

部分在线插件源挂 Cloudflare 挑战。提议在引擎里用 impit（伪装浏览器 TLS / HTTP2 指纹的 fetch）替代 Electron `net.fetch`，以提高成功率。

## 决策

不采用。引擎出网继续用 Electron `net.fetch`；挑战页交给主进程的浏览器代抓（见 ADR-0005）。

## 后果

- 依赖少一个带原生二进制的包（impit 0.14.6 覆盖 6 个平台，打包还要 `asarUnpack`）。
- 实测 5 个挑战源（NO視頻、路漫漫、avtoday、jable、hanime）impit 0/5 通过，与 `net.fetch` 逐个相同。`net.fetch` 本来就是 Chromium 网络栈，JA4 前两段与 impit 的 chrome 配置一致；这些站返回的是要执行 JS 的托管挑战，指纹伪装帮不上。
- 换成国内家宽也不改变这个关系：能被指纹放过的站 `net.fetch` 已能过，要跑 JS 的站两者都过不了。

## 否决方案

- impit 作为兜底再试一次：同样 0/5，只增加延迟和包体积。
- 改用 Node 内置 fetch：指纹（JA4 `t13d5212h1`）恰恰是会被拦的那种。
