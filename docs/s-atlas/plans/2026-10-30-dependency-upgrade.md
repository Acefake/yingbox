# 依赖分批升级实现计划

基线：e2a23a9，工作区干净。按用户确认的三批次执行，修改 package.json、pnpm-lock.yaml；必要时只调整构建配置和直接受影响的兼容代码。

- [x] 第一批：Vue 3.5.44、@vitejs/plugin-vue 6.0.10；类型检查和桌面构建通过。全量 3778 通过、3 失败；其中 2 个 ESLint 超时用例单独复跑 22 项全通过，余下为原有行数门槛。
- [x] 第二批：Vite 8.3.5、electron-vite 6.0.0；类型检查、桌面/Web/服务端构建和离线服务器 smoke 全通过。沙箱 preload 单文件且仅 require electron，桌面/Web 主界面未预加载播放器包。全量 3779 通过、2 失败；依赖范围基线已随精确锁定收缩并复查 4 项通过，余下为原有行数门槛。官方兼容的 rollupOptions 配置继续使用。
- [x] 第三批：Electron 45.1.0、electron-builder 26.18.0；类型检查、桌面构建和 Windows NSIS 打包成功。全量 3780 通过、11 跳过，只剩原有行数门槛失败。显式禁止当前 NSIS 流程不需要的 electron-winstaller 安装脚本，pnpm install 复查成功。
- [x] 覆盖安装：安装退出码 0；EXE、app.asar、mpv 和源码下载说明与 win-unpacked 哈希一致；安装目录不含源码 tar。安装后的正常主窗口通过原生 UI 检查，原有观看记录与直播设置仍在；未更改用户片库配置。

基线验证沿用前轮同一应用代码的结果：全量测试 3775 通过、6 失败；5 个播放器/取帧失败单独复查通过，剩余一个行数门槛涉及未改动的 3 个应用文件。每批记录新增失败，不能隐藏基线问题或跳过必要检查。

最终验证：

- 新安装包 206,594,859 字节，约 207 MB；独立源码归档与 SHA-256 文件继续在 dist 提供。旧安装包在本机忽略目录留作回退，未发布 Release。
- Electron 实际内置 Node 24.22.1。真实程序在临时数据目录启动，两个 utilityProcess 经真实 IPC 响应：在线源返回 29 项，片库成功新增、扫描测试视频。独立播放器使用窄 preload，视频 readyState 为 4、currentTime 超过 0.5 秒，无视频错误。该检查未使用用户片库或真实密钥。
- 打包后的 EXE 以 Node 模式执行 SQLite 查询成功，直接加载 asar 内的 ONNX 模块，CPU/DML/WebGPU 后端均存在；安装后文件逐一核对一致。
- style、case、copy、格式检查通过。全量 ESLint 仍有基线问题：未改动的 .tmp/output 脚本 3 个错误，以及临时脚本和既有源文件的格式警告；未清理或改写这些无关文件。check:size 仍报原有 3 个应用文件超过 400 行。
- 自审覆盖完整依赖、锁文件、脚本权限和直接构建调用方；独立只读评审未发现阻塞问题。平台风险：本轮只验证 Windows；Electron 45 的 macOS 最低版本为 13，干净 Windows/其他机器兼容性尚未实测。没有升级 TypeScript、Vue Router 等其他大版本。
