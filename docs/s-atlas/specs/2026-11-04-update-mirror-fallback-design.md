# 更新下载多源回退（国内直连 GitHub）

- 日期：2026-11-04
- 状态：已确认

## 目标

不挂代理时，桌面 Windows、安卓、NAS/库服务端仍能检查更新并下载安装包。官方 GitHub 可达时不走镜像；不可达时按白名单反代回退。安装包校验规则不变（资产 `digest` / SHA-256）。

## 背景与实测

当前更新链路直连 `api.github.com` 与 `github.com` / `objects.githubusercontent.com` 下载地址。[ADR-0037](../../adr/0037-android-release-and-update.md) 写明「GitHub 无法连接则失败，不默认引入第三方下载代理」。

2026-11-04 对本仓库 `v1.0.4` 探测（本机可直连 GitHub；你确认国内无代理下下列地址也可访问）：

| 源 | Releases API | 小文件 / APK 片段 |
| --- | --- | --- |
| 官方 | 可用 | 可用 |
| `https://gh-proxy.com/` + 完整官方 URL | 可用，内容一致 | 可用，内容一致 |
| `ghproxy.net` / `ghfast.top` | API 403（本机） | 小文件可用 |
| `ghproxy.com` / `mirror.ghproxy.com` | 不可用 | 不可用 |
| jsDelivr | 不能替代 Releases API | 不用于发布资产 |

结论：首版白名单只采用 **`gh-proxy.com`**（API 与资产同一改写规则）。

## 范围

| 端 | 检查更新 | 下载安装包 |
| --- | --- | --- |
| 桌面 Windows | `desktop-updater` | 同左，对 `asset.url` 回退 |
| 安卓（内嵌 Node / NAS `view.appUpdate`） | `githubReleases()` | — |
| 安卓 APK | — | `AppUpdater` 对返回的 `url` 回退 |
| macOS | 仍无应用内更新（ADR-0038） | — |

不在范围内：设置页增加镜像开关、自建 CDN、差分包、签名公钥体系。

## 决策

1. **共享纯规则**（`src/shared/release/`）：给定官方 HTTPS URL，产出候选列表 `[官方, …改写]`。仅当主机属于白名单（`api.github.com`、`github.com`、`objects.githubusercontent.com`）时才改写；改写形式为 `https://gh-proxy.com/` + 原始完整 URL（含 path/query）。其它主机原样只返回自身，不套镜像。
2. **回退策略**：按候选顺序请求。短超时（与现网检查超时同级，约 12–15 s）。仅网络错误、超时、429、5xx 试下一个；其它 4xx 不换源。成功响应（API 为 JSON 数组；下载为完整体且通过摘要）即停。
3. **环境变量覆盖**：若设置了 `YINGBOX_ANDROID_RELEASES_URL`（或日后桌面同类变量），**只请求该地址，不做镜像回退**（管理员显式源）。
4. **校验不变**：下载边写边算 SHA-256，与发布资产 `digest`（或既有字段）一致才完成；失败删除临时文件并试下一候选；全部失败再报错。不接受候选 URL 指向白名单之外的主机（下载前再校验）。
5. **安卓视图契约**：`view.appUpdate` 仍返回官方 `url`（形状不变）。Kotlin `AppUpdater` 用与 TS 相同的改写规则生成候选并依次下载（规则以共享模块为准；Kotlin 侧保持行为一致的常量表/同构函数，并有测试锁住前缀与主机白名单）。
6. **ADR**：新增一篇，部分取代 ADR-0037「不默认引入第三方下载代理」；发布选包仍跟 ADR-0038。
7. **不默认暴露 UI**：用户无感知；失败文案可提示检查网络或代理，不枚举镜像域名。

## 否决方案

- 只提供可配置源、默认仍直连：开箱用户仍更新失败。
- 内置多个不稳定公共反代：增加攻击面与超时成本；当前仅 `gh-proxy.com` 双边验证通过。
- 检查更新也改走 jsDelivr：无法提供 GitHub Releases JSON 形状。

## 风险

- 公共反代可能随时失效或改行为；缓解：官方优先、白名单可改、摘要校验。
- API 与资产若都只来自被篡改的镜像，摘要可被一并伪造；缓解：官方优先；首版接受与「直连 GitHub」相同的信任模型，不做额外签名。
- 国内网络与本机探测可能再度分叉；以你确认的 `gh-proxy.com` 可访问为准，合并前用无代理环境 spot-check。

## 验证

1. 纯函数测试：官方 URL → 候选列表快照；非白名单主机不改写；自定义 releases URL 路径不启用回退。
2. 桌面更新器：官方成功不请求镜像；官方失败后镜像成功；摘要错误不安装。
3. 服务端 `githubReleases` / 安卓下载：同样的失败回退与摘要行为。
4. 手工：无代理环境检查更新并完成一次小版本或 `sha256sum.txt` 级下载探测。
