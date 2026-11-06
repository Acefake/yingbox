# 播放器鼠标交互实现计划

目标：桌面/Web 单击空白切换播放并收起控件；底边/顶边停留 150ms 显示对应操作，播放中离开 2 秒隐藏。暂停保留已显示的操作。手机和电视保持现有输入方式。

1. 在 controls/pointer-controls.ts 捕获单击、双击与鼠标边缘。单击等待 Artplayer.DBCLICK_TIME；第二击取消单击。销毁时清除监听和定时器。
2. 抽出 hotkeys/player-osd.ts 复用中央反馈；install-hotkeys.ts 桌面双击移除播放补偿，触屏保留。PlayerStage.vue 根据边缘状态显示顶栏。
3. 更新 tests/player-controls-visibility.test.ts，使用真实 Artplayer 与模拟媒体播放，覆盖单击暂停/恢复、边缘唤出、自动隐藏、双击不暂停、按钮隔离和销毁。
4. 运行模块 Vitest、typecheck:web、ESLint、check:style，自审并进行只读独立评审。保留此前工作区改动。
