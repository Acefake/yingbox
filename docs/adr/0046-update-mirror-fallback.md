# ADR-0046 更新检查与下载的 GitHub 镜像回退

- 日期：2026-11-04
- 状态：已采纳
- 部分取代：[ADR-0037](0037-android-release-and-update.md)「不默认引入第三方下载代理」
- 补充：[ADR-0038](0038-unified-github-release.md) 更新器取包与摘要校验

## 背景

桌面、安卓与 NAS 的应用内更新直连 GitHub Releases API 与资产下载地址。国内不挂代理时检查或下载常失败。实测公共反代 `https://gh-proxy.com/` + 完整官方 URL 可访问 API 与安装包，且内容与官方一致。项目选择零运维，不自建 CDN。

## 决策

1. **官方优先，白名单改写回退**：候选顺序为官方 HTTPS URL，再 `https://gh-proxy.com/` + 同一 URL。仅改写主机 `api.github.com`、`github.com`、`objects.githubusercontent.com`。
2. **何时换源**：网络错误、超时、HTTP 429 / 5xx；其它 4xx 不换源。每个候选使用独立超时，避免官方超时后 signal 已 abort。
3. **校验不变**：安装包仍按资产 `digest` / SHA-256 校验；失败丢弃临时文件并可试下一候选。下载候选仅接受白名单 GitHub 主机（`githubAssetCandidates`）。
4. **自定义源不做镜像**：请求地址不是内置默认 `api.github.com/.../releases` 时（含 `YINGBOX_ANDROID_RELEASES_URL`），只请求该地址，不套 gh-proxy。
5. **覆盖端**：桌面 `desktop-updater`、服务端/内嵌 Node `githubReleases`、安卓 `AppUpdater` 下载（Kotlin 与 shared 规则同构）。无设置页镜像开关。
6. **共享实现**：纯规则在 `src/shared/release/mirrors.ts` 与 `fetch-first.ts`。

## 后果

- 依赖公共反代可用性；失效时仍可直连官方，两边都挂则更新失败。
- 若 API 与资产都只来自被篡改的镜像，摘要可被一并伪造；官方优先降低该路径概率，不做额外签名。
- ADR-0037 中「没有默认引入第三方下载代理」不再成立，以本 ADR 为准。

## 否决方案

- **仅可配置源、默认仍直连**：开箱用户在国内仍失败。
- **内置多个不稳定公共反代**：超时与攻击面增加；当前仅验证 `gh-proxy.com`。
- **用 jsDelivr 当 Releases API**：无法提供所需 JSON 形状。
