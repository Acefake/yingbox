# 影盒全客户端网络优化方案

日期：2026-11-06。状态：方案草案，未接入产品代码，未修改系统或应用配置。

## 结论

提供“设置 → 网络优化”，覆盖桌面、Web/NAS、Android 手机和 TV。普通用户使用内置服务地址与自动回退；高级用户可以填写自建反代或网络代理。Docker 加速单独放在 NAS 部署帮助中。

推荐先交付 GitHub 多镜像回退和 TMDB 备用 API 域名，再接入应用内解析优化、网络代理和 NAS 发布镜像。公共服务作为可替换的候选，不承诺长期可用。暂不增加自营代理服务器的固定费用；自营反代及镜像仓库的流量和存储费用需另行评估。

## 1. 本机探测结果与地址

2026-11-06 约 11:27，Windows 本机使用 curl 和 Git 发出公开请求。curl 使用 `--noproxy '*'`，Git 单次清空 http.proxy；没有 HTTP_PROXY、HTTPS_PROXY、ALL_PROXY 环境变量。未使用私人凭据、未关闭 TLS 校验。

重要边界：api.tmdb.org 通过本机 DNS 解析出 198.18.1.137，属于合成地址特征，可能存在 TUN/透明代理。以下结果只代表当前网络路径，不能当作国内裸直连或手机、TV、NAS 的验证。单轮样本不用于判断哪一个服务长期更快。

### GitHub

- `https://gh-proxy.com/`：Raw 文件 HTTP 200，正文与公开样本相符；GitHub 公开仓库 API 返回 200 JSON；小型 Release 校验和附件返回 200 且包含预期文件条目；`git ls-remote` 成功读取 HEAD。
- `https://ghfast.top/`：Raw 和同一 Release 附件通过。API、Git clone 未验证。
- `https://ghproxy.net/`：Raw 和同一 Release 附件通过。API、Git clone 未验证。
- 官方 Raw 地址在本轮也成功。因此默认官方优先，不因为存在镜像就强制绕行。

格式为“镜像前缀 + 完整官方 URL”，例如：

```text
https://gh-proxy.com/https://raw.githubusercontent.com/octocat/Hello-World/master/README
https://ghfast.top/https://github.com/cli/cli/releases/download/v2.65.0/gh_2.65.0_checksums.txt
```

探测样本分别是 octocat/Hello-World 的 README、公开仓库元数据与 Git 引用，以及 cli/cli 的 v2.65.0 校验和文本。没有下载大型安装包，没有完整 clone；不宣称断点续传、大文件下载或全部 Git 操作已验证。

### TMDB

- `https://api.themoviedb.org/3`：本轮请求 configuration 时 TLS 握手失败。
- `https://api.tmdb.org/3`：configuration 返回 TMDB 格式的 HTTP 401 / status_code 7，证明网络和 API 鉴权入口可达。没有携带 Token，不能标成“刮削成功”。作为备用域名候选，不将其长期支持状态当作既定事实。
- `https://image.tmdb.org/t/p/`：公开 w92 PNG 样本返回 200、image/png，正文具有 PNG 文件头。
- 未找到并核实可直接推荐的公共 TMDB 第三方 API 反代，不内置来源不明的 Token 中转服务。

不提供固定 hosts IP。本轮 DNS 为合成地址，即使使用该地址连接成功，也不能将它发布给其他设备。

### Docker

- `https://docker.1ms.run`：公开 Alpine latest 清单返回合法 JSON，支持获取镜像清单。本轮未证明所有仓库均可匿名使用。
- `https://docker.m.daocloud.io`：公开 Alpine latest 清单返回合法 JSON，支持获取镜像清单。
- 两项首次可返回正常 Bearer 鉴权挑战；探测程序按挑战获取匿名短期 Token 后重试。401 本身不判为服务失效。
- `https://docker.1panel.live`：本轮请求超时，不作为当前推荐启用项。
- `https://k-docker.asia`：本轮 TLS 握手失败，不作为当前推荐启用项。
- `https://ghcr.m.daocloud.io/acefake/yingbox-nas:stable` 和 `https://m.daocloud.io/ghcr.io/acefake/yingbox-nas:stable`：清单请求均返回 403，明确提示镜像不在白名单，不能用于影盒部署。

以上仅完成 Registry 清单检查，未完整下载镜像层或执行容器。Docker Hub 加速地址不等于 GHCR 加速地址。

## 2. 页面与设置行为

### GitHub 加速

默认“自动”：官方优先，网络失败时按已启用候选顺序回退。提供“仅官方”“自动”“指定镜像”。

内置三项上述候选，允许添加、停用、删除自定义项和调整顺序。官方入口固定保留。每个地址分别显示 API、Raw、Release、Git 引用四种能力及最后检测时间；未测显示“未验证”，不显示笼统绿色可用。

gh-proxy.com 初始允许 API、Raw、Release；ghfast.top、ghproxy.net 初始只允许 Raw、Release。Git 引用探测用于诊断，不因镜像支持 clone 就在应用里新增 Git 管理功能。

### TMDB 连接

默认“自动”：主 API → 备用 API。图片单独测试和显示状态。高级设置包含 API 基地址、图片基地址、应用内解析优化、网络代理。

连接测试分为“网络可达”和“Token 有效”。无 Token 的 401 显示“服务可达，尚未验证凭据”；已有 Token 时由持有秘密的后端调用 configuration 验证，Token 不回传前端。

添加第三方 API 地址时明确提示它会接收 TMDB Token，只有用户主动选定后使用；不向所有候选批量发送 Token。图片地址与 API 地址分别配置。

### 高级网络代理

连接方式：直连、跟随系统（平台确实支持时提供）、自定义。首版支持 HTTP CONNECT，认证信息存入各端安全存储；SOCKS5 另行实现，不显示未支持选项。

范围分别选择 TMDB、GitHub。影片播放、115、局域网请求默认不进入这条代理链。显式代理失败时默认报错；用户可以开启“代理失败尝试直连”。

### NAS Docker 帮助

提供镜像源列表、清单检测和复制配置。明确配置属于宿主机 Docker，不通过影盒容器直接修改 daemon.json，不挂载新增 Docker socket 权限，不自动重启 Docker。

影盒 NAS 当前 Compose 使用 GHCR，单独显示“影盒镜像检查”，不能用 Alpine 测试通过替代。测试动作不修改配置。

## 3. 全端接入与配置归属

- 桌面：统一策略在主进程持有，经窄接口提供给在线引擎和片库引擎；Electron 网络栈、Node 请求、图片及更新下载分别接入。不能只改渲染器或默认 session。
- Web/NAS：服务端持有出站配置并负责 TMDB、GitHub 请求。网页只调用现有服务端接口；NAS 图片需要走受控服务端路径，避免浏览器直连图片绕过策略。
- Android 手机/TV：本机持有配置，内嵌 Node 与 Kotlin 更新下载、图片加载遵循同一策略。原生 API 与 Node 通过现有桥接同步，不维护两份独立设置。
- Android/桌面连接远程 NAS 时，本机更新用本机配置；NAS 刮削用 NAS 配置。设置页标清“当前设备”或“NAS 服务端”。
- Web 管理入口沿用服务器现有认证模型；已有独立角色能力时仅管理员可改，缺少时不虚构管理员权限。公网部署应启用服务器 Token，写接口必须有对应鉴权。

仓库已核对的接入点：`src/shared/release/mirrors.ts`、Android `update/ReleaseMirrors.kt`、`src/engine/online/index.ts` 的 tmdb 方法、`src/main/library/platform/` 的注入式 fetch、`src/server/online/`、缩略图/图片请求入口以及各端更新下载器。实现前继续确认每个实际调用方，避免只改常量。

## 4. 请求、回退和缓存规则

共享模块保存“服务、用途、候选端点、能力、启用状态和优先顺序”，各宿主提供实际网络发送与配置存储。健康状态按端点和用途独立记录，附时间；历史成功不能永久显示在线。

一次请求先确定服务与用途，再确定端点，最后按本机/服务器代理配置发送；镜像和传输代理不能形成两层各自重试的嵌套循环。建议连接超时 5 秒、小请求总预算 20 秒，每次最多尝试 3 个端点。下载使用单独的流式超时及取消机制。

网络超时、连接失败和上游 5xx 可以回退；401/403 的凭据或权限错误不盲目换源。官方真实 429 遵守 Retry-After，不以轮换镜像规避配额。镜像端点自身的限流单独记录。连续网络失败 3 次冷却 15 分钟，之后允许一次探测，参数属于初始设计值。

官方域名、镜像域名和重定向目标都需校验；保留现有 SSRF 与私网限制。自定义可信局域网代理通过专用配置边界允许，不放宽通用 URL 请求的私网限制。Authorization、Cookie 不跨非授权源转发；不向公共 GitHub 镜像传私人仓库凭据。

更新安装包必须通过既有签名/校验链；同一镜像提供的文件及其 checksum 不能独立证明可信。不同镜像之间续传前检查资源身份，无法确认则重下。发布元数据与文件可能不同步，不能无条件跨镜像拼接版本信息。

## 5. TMDB 解析优化的范围

第一阶段先使用备用 API 域名，不改系统 DNS 或 hosts。第二阶段再提供应用内域名限定解析：仅对 TMDB 指定域名启用，保留 URL 域名、SNI 与证书验证，按 DNS TTL 更新，不把 IP 写死进客户端。

可选 DoH 解析服务必须单独验证可达性和隐私约束，不假定它能解决线路封锁。遇到 198.18.0.0/15 等合成/保留地址，不将其存入可同步的公共端点列表，不将更改解析视为可用性的唯一证据。显式代理开启时优先让代理处理目标域名，避免本地解析与代理出口不一致。

DNS 优化仅解决解析层问题；目标 IP、TLS 或线路受阻时，仍需代理或用户自建反代。

## 6. NAS 发布与镜像同步

当前 `docker-compose.nas.yml` 使用 `ghcr.io/acefake/yingbox-nas:stable`，updater 也来自 GHCR。要实现开箱即用的 NAS 拉取加速，推荐由项目维护者将两个必需镜像的可分发版本同步到一个经过确认的第二仓库，或为确切镜像申请公共镜像白名单。

发布同步保持多架构 manifest、版本标签与 digest 对应，不仅复制 stable 标签；现有 updater 固定 digest 必须验证目标仓库是否保留该 digest。应用镜像可用不代表 updater 镜像可用。Compose 通过已有 YINGBOX_IMAGE 覆盖应用镜像；若要支持 updater 替代源，需要显式增加对应配置。

第二仓库账号、命名空间、配额、再分发许可和发布凭据未配置前，不编造“立即可用”的影盒镜像地址，也不在本任务中发布或更改 CI 凭据。

## 7. 实施顺序与验收

1. 共享端点策略和设置页：GitHub 三个候选、TMDB 两个 API 地址、真实能力检测。保留当前单镜像配置迁移，新增 ADR 明确取代/扩展 ADR-0046 的部分。
2. 接通桌面、服务端、Android 手机/TV 的所有相关请求，补齐图片和更新下载覆盖；确认不影响媒体流、115 和局域网。
3. 加高级代理与按设备保存；应用内 DNS 优化单独交付，不与第一阶段域名回退捆绑。
4. NAS 部署帮助和准确镜像清单探测；确认第二发布仓库后再接 CI 同步与 Compose 配置。

每个可交付阶段需有：端点选择及错误回退的纯逻辑测试、重定向凭据隔离测试、受控本地网络集成测试。真实验收覆盖四端的 TMDB 搜索、后台刮削、图片、GitHub 更新检查和实际附件下载。

NAS 验收必须在目标 NAS 上完成实际 docker pull，验证 manifest、镜像层、架构、固定 digest 与自动更新；本机 curl 结果不能替代。至少在一条关闭透明代理的目标网络复测后，才可标“无代理环境验证通过”。默认自动模式下官方可用时走官方，失败能回退，全部失败能给出具体端点与原因。

本任务为探测与方案，未运行项目测试、构建或真实 115/媒体业务操作。探测没有形成完整客户端 E2E 结论。

## 8. 来源

- GH-Proxy 服务说明：https://gh-proxy.com/ ，用途能力以实际测试为准。
- ghfast：https://ghfast.top/ 。
- ghproxy.net 服务说明：https://ghproxy.net/ 。
- DaoCloud 官方项目：https://github.com/DaoCloud/public-image-mirror ，包含 Docker Hub/GHCR 的不同映射及白名单说明。
- 1Panel 配置文档：https://1panel-dev.github.io/docs/v2/user_manual/containers/setting/ ，文档存在地址不等于本轮可达。
- Docker 镜像配置：https://docs.docker.com/docker-hub/image-library/mirror/ 。
- TMDB API：https://developer.themoviedb.org/docs/getting-started ，图片：https://developer.themoviedb.org/docs/image-basics 。
