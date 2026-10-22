# ADR-0009 两个 utilityProcess 统一线协议

- 状态：已采纳（2026-10-22）
- 相关：PR #64（宿主统一见 #61、#62）

## 背景

后台引擎用 `call / result / event / host / hostResult / shutdown`，媒体库引擎用 `request / response / subscribe / images-cached / ready / shutdown`，宿主里各有一套编解码适配器。

## 决策

`src/shared/utility/protocol.ts`（纯类型）定义九种消息：主 → 子 `call`、`reply`、`subscribe`、`shutdown`；子 → 主 `result`、`ready`、`event`、`host`、`busy`。方法表各自保留（引擎：契约通道 + `HostMethods`；媒体库：`LibraryRpcMap`，参数在 `args[0]`）。删掉 `UtilityHost` 的协议适配器和两边的旧信封。

## 后果

- 一个宿主、一套信封；新增消息类型只改一处，两个进程都要遵守。
- 媒体库的 `images-cached` 通知变成普通 `event`；两个引擎都报 `ready`。

## 否决方案

- 保留两套信封、在宿主里适配：「一件事两种做法」，适配层本身就是缺陷来源。
- 合并方法表：两边的入参校验位置不同（引擎在主进程 IPC 边界，媒体库在引擎内、与 HTTP 服务共用），合并会打乱这条边界。
