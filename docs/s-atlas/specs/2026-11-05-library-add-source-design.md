# 媒体库「添加来源」统一入口设计

日期：2026-11-05　状态：设计已获用户确认

## 目标

参考 Infuse 的「添加文件」：媒体库添加文件夹时先选来源类型，再走各自的配置与选目录流程。
本版只收拢现有能力，不改后端，不新增网盘类型。

## 现状

- 本地文件夹：设置 → 媒体库「文件夹」分组与片库页空状态各有「添加文件夹…」。
- 115：`Pan115LibraryGroup`，只在网页 / NAS 版显示（115 片库适配在服务端）。
- WebDAV / Alist：`WebDavGroup`，只在桌面版显示（凭据与流转在主进程）。

## 设计

1. 入口：非番号分区的两处「添加文件夹…」改为「添加来源…」，打开 `LibrarySourceSheet`（`LibrarySheet` 玻璃面板）。
   番号库（section=jav）流程不变。
2. 第一步选来源，分组：本机（本地文件夹）、网盘（115 网盘）、网络共享（WebDAV / Alist）。
   当前端用不了的来源不列出：桌面 = 本地 + 115 + WebDAV，网页 / NAS = 本地 + 115。
   桌面端 115 通过主进程接入：引擎扫描经代办 `pan115Propfind` 取目录，播放走 `yingbox-dav://pan115/…`（内置播放器与 mpv 代理）。
   其他网盘（阿里、夸克等）经 Alist 的 WebDAV 添加。
3. 第二步：
   - 本地：沿用 `useLibraries.addFolder`（系统对话框 / 服务端目录浏览），完成后关闭。
   - 115：`FolderTree` 选目录，「添加并扫描」，路径 `remotePath('pan115', /cid)`，`automation.storage = 'cloud'`。
   - WebDAV：已有服务器时是文件夹浏览（`WebDavFolderPicker`，带「添加新服务器」）；没有时先进入新增表单
     （`WebDavSourceForm`，可测试连接，保存后进入浏览）；选好点「添加到媒体库」。
4. 结构：
   - `sources/source-kinds.ts`：纯函数，按环境得出可用来源与分组，有单元测试。
   - `sources/LibrarySourceSheet.vue`：两步切换与各来源流程。
   - 删除 `Pan115LibraryGroup`；`WebDavGroup` 只保留服务器管理（编辑 / 删除），标题改「网络共享」，
     番号「添加为番号文件夹…」保留。

## 不做

新网盘类型、番号库流程、网页 / NAS 端的 WebDAV。

（后续修订：桌面端补上了 115，见上；后端新增仅限桌面主进程对 115 片库的接入。）

## 验证

`source-kinds` 单测覆盖桌面 / NAS / 网页三种环境；`typecheck`、`lint`、`check:style`；浏览器预览看两步。
