# 添加存储

基线：235f3a7fd746c0799cf5c5cdf7d065078d92e77c。开始前的目标文件副本保存在 `C:/Users/10228/.codex/artifacts/storage-implementation-baseline`；保留工作区已有改动。

1. 新增 `src/shared/contract/storage.ts` 与 `src/main/storage/`，保存系统已认证的 SMB 共享目录，验证目录可读，串行、原子持久化；不接收或保存 SMB 密码。Windows 使用 UNC，其他桌面系统使用已挂载目录。测试目录校验、并发保存、失败不丢数据和移除。
2. 在 library 的公开入口提供 WebDAV 源表单、目录选择和添加片库的管理入口，复用现有加密凭据和删除引用检查。
3. 新增 `features/netdisk/storage/StoragePage.vue`：115、WebDAV、SMB 三种类型，实际保存的存储列表；所有卡片及列表用 `.yb-glass`。115 复用二维码，WebDAV 测试后保存，SMB 复用操作系统认证。连接状态只由实际检查结果产生。
4. 新增 `/storage` 路由；未登录 `/netdisk` 显示存储页，已登录保留网盘搜剧；已登录时仍能进入存储管理。保留侧栏外壳、tokens 和现有页面头图机制。复用已确认稿的插图，不重画。
5. 运行存储、WebDAV、扫码和导航模块测试，类型检查及样式检查；检查真实窗口的添加入口和玻璃表面。自审任务差异后派只读独立评审。不提交、不操作用户真实存储数据。

浏览器 / NAS 客户端继续支持现有 115 接口；WebDAV 和 SMB 暂沿用桌面端能力，卡片说明平台限制，不伪造服务端接口或连接状态。
