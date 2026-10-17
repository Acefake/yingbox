# Amane in yingbox

固定版本：0.20.1，commit `e45b5867a93793fedca3bfed9c60b9ca2672e68b`。

`upstream` 是固定版本的 Git 子模块，保留完整 GPL-3.0 源码和构建脚本。克隆影盒后使用 `git submodule update --init packages/amane/upstream` 获取它。影盒使用 Vue 组件承载片库、详情和高级搜索，通过主进程调用 Amane 后台；不嵌入原版网页。顶部横向导航保留片库、演员、媒体库、文件、任务和设置入口。

## 开发使用

启动影盒后在成人模式侧栏打开 Amane。后台程序的发现顺序为 `YINGBOX_AMANE_EXECUTABLE`、安装包的 `resources/amane/onedir`、开发目录的 `resources/amane/onedir`、桌面的 `Amane/onedir`。也可以在板块设置中选择完整安装目录内的 `Amane.Server.exe`。

后台运行目录需要保留 PyInstaller 的整个 onedir，不能只复制 exe。影盒默认使用自己的数据目录和 18180 端口，不修改单独安装的 Amane 数据库，不结束外部服务；原有数据可通过明确选择数据目录或连接已有服务使用。

密钥由主进程用 Electron safeStorage 保存，普通渲染进程不接触服务密钥。图片通过受限协议访问；Vue 详情中的播放按钮通过已入库媒体 ID 查询路径交给影盒播放器。

本模块不实现网盘登录、目录 API 或网盘配置。

## 开发模式:运行源码

开发(未打包)时,影盒按 `resolveSourceRuntime()` 直接运行 `upstream` 的 Python 源码:使用 `.venv` 解释器、editable 安装,修改 `src/amane` 后重启后台即生效。发布版仍使用打包后的 `Amane.Server.exe`。

- 依赖准备:在 `upstream` 下执行 `uv sync`;Windows 真彩终端下 structlog 需要 `colorama`,已装入 venv。
- 开关:强制打包后台 `YINGBOX_AMANE_FORCE_EXE=1`;指定其他源码目录 `YINGBOX_AMANE_SOURCE_DIR`。
- 重启:Amane 设置页「保存并连接」会重启后台进程;或重启影盒。
- 注意:`git submodule update` 会覆盖 `upstream` 内的本地修改;需长期保留时请另存分支或改 fork。

## 准备 Windows 运行资源

在构建环境安装 uv、Python 3.14，运行：

```powershell
powershell -NoProfile -File scripts/prepare-amane.ps1
```

脚本从固定子模块的锁文件安装构建依赖，仅构建 Amane 后台，无须 React 前端或 .NET 托盘壳。产物放在 `resources/amane/onedir`，由 electron-builder 的 extraResources 携带；同时携带许可证、来源声明和对应源码归档。脚本只在构建者主动调用时运行，应用启动不会下载或安装依赖。

开发机已按上述步骤构建 `resources/amane`（onedir、LICENSE、SOURCE.md 和对应源码归档），并验证过健康检查与 Token 鉴权；需要重建时先删除 `resources/amane`，脚本检测到目录已存在会拒绝执行。实际界面、网络刮削和媒体播放仍需在开发客户端中验收。

## 许可证

Amane 按 GPL-3.0 分发，见 `upstream/LICENSE`。影盒集成代码未修改上游源码。分发包含的 Amane 后台时，必须同时提供对应版本的源码、许可证及构建入口；修改上游时也须保留相应修改记录和源码。最终组合发行的许可义务应按最终发行形态核对，独立进程并不自动免除 GPL 要求。

Vue 高级搜索对齐上游筛选字段：演员、导演、标签、制作商、发行商、系列、用户标签、关联文件、中字、无码、马赛克标记、分辨率和类型。筛选通过 Vue 状态传入片库查询，支持叠加与清除。

设置页由 Vue `ConfigSettings.vue` / `ConfigField.vue` 根据 `/api/config/schema` 生成，读取和保存 `/api/config`。可见分组、字段上下限、站点资格和隐藏项使用后台结构；中文文案来自固定版本 Amane 的 `settings.json`（GPL-3.0）。站点列表支持拖动和键盘按钮排序，分组草稿独立保存，失败保留输入，保存只提交本组发生改变的字段，后端校验并重建运行时。连接与存储设置单独折叠，不作为 Amane 配置字段提交。

## Vue 智能体

顶部“智能体”使用 `AgentPanel.vue`，通过固定版本的 `/api/agent/sessions`、`/trace`、`/agui` 和 `/agui/cancel` 接口管理会话与回合，保留原版后台工具及审批。请求发起后关闭事件订阅，后台回合独立运行；Vue 活跃时每秒读取运行中的持久化回放，空闲时降低频率，离开页面停止轮询。用户文本、回复、思考、工具参数/结果、用量、错误及审批均由回放恢复，不把原始 HTML 注入页面。

支持新建、重命名、删除会话、思考覆盖、取消回合。审批逐项选择批准/拒绝后统一续跑，没有默认批准。查询预设可查看分页结果、保留、删除和导出当前页 CSV。模型仍在“设置 → 智能体”配置。桌面走白名单 IPC，手机走现有同源代理；接口密钥沿用现有连接，不新增分享或记录。网页 HTTP 环境下运行 ID 不依赖 secure-context 的 randomUUID。

智能体错误由 `amane-agent-error.ts` 分类：余额不足、认证失败、访问拒绝、限流、连接异常与未配置使用中文原因及设置入口，原始报文折叠在技术详情中并遮盖常见密钥格式。此处理仅改善错误展示，不会充值、更换用户模型或自动重试失败回合。
