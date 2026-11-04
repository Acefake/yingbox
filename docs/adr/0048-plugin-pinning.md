# ADR-0048 CatSpider 插件固定到提交并校验摘要

- 日期：2026-11-04
- 状态：已采纳
- 补充：[ADR-0014](0014-plugin-isolation-and-session-origin.md) 插件隔离；[ADR-0046](0046-update-mirror-fallback.md) 镜像回退

## 背景

内置的 29 个插件脚本来自两个第三方仓库的 `main` 分支，地址经第三方代理 `ghp.xptvhelper.link` 转发。上游随时可改，代理可篡改内容；QuickJS 沙箱限制了权限，但被替换的脚本仍可输出恶意播放地址或滥用允许的网络接口。

## 决策

1. **注册表固定**：`src/engine/online/vod-sites.json` 的每个插件，`ext` 为 jsDelivr 的 `cdn.jsdelivr.net/gh/<owner>/<repo>@<提交 SHA>/<路径>`，并带 `sha256`（脚本内容摘要）。gist 来源已含修订号，只补摘要。
2. **加载时校验**：`createPluginLoader` 对有摘要的地址，缓存和下载的内容都必须匹配；不匹配视为失败，不执行。有摘要的内容不可变，缓存不过期。
3. **镜像回退**：固定地址依次尝试 jsDelivr、`gh-proxy.com/https://raw.githubusercontent.com/<owner>/<repo>/<SHA>/<路径>`；镜像内容同样要过摘要，镜像不可信也安全。
4. **更新靠脚本**：`scripts/gen-plugin-registry.mjs` 把条目固定到上游当前提交并写入摘要（`--refresh` 重新固定），产物由人审阅后提交；不做运行时订阅，应用不自动拉取新插件。
5. 去掉 `ghp.xptvhelper.link`。

## 后果

- 插件更新随发版；上游修了站点变更要重新跑脚本。
- 固定到提交后，上游删仓或改名会让 jsDelivr 取不到，此时走 GitHub 镜像或本地缓存。
- 摘要保证脚本没被改，不保证脚本本身无害；仍靠 ADR-0014 沙箱与人工审阅新增插件。

## 否决方案

- **开放订阅任意插件清单**：把第三方代码的信任面交给清单维护者。
- **只固定提交不校验摘要**：镜像与代理仍可篡改内容。
- **继续用 `main` 分支地址**：上游一次提交就改变所有用户执行的代码。
