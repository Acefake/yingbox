# ADR-0030 视图域 `view`：服务端拼好页面数据，类型由一份描述生成 Kotlin

- 日期：2026-11-02
- 状态：已采纳
- 相关：ADR-0028（安卓端方案，决策 3「业务逻辑上移服务端」要求视图接口另立 ADR）、ADR-0034（安卓端内嵌 Node）、ADR-0009（统一线协议）、ADR-0010（独立服务）

## 背景

ADR-0028 决定把渲染层里不依赖 Vue 的纯逻辑搬进共享代码，服务端新增视图域返回「已经做好的数据」，原生界面只展示和交互；视图接口的结果类型只在一处用 TS 定义，生成 Kotlin，类型漂移时构建失败。

动手前核对到的现状：

- 域名 `app` 已被桌面 IPC 契约占用（`src/shared/contract/app.ts`，`networkIps`），不能再用。
- 服务端已经经 HTTP 暴露引擎的 `online` 域（`/api/engine/rpc`），原生端能调原子接口（豆瓣浏览、TMDB、CMS），缺的是「拼装」：首页由哪几行组成、豆瓣卡怎么用 TMDB 补海报、榜单失败退回什么。这些规则写在渲染层（`features/online/utils`、`composables`）。
- 仓库的依赖基线只减不增（AGENTS.md「Engineering gates」），引入 JSON Schema 生成器或 kotlinx.serialization 都要单独论证。

## 决策

1. **新域名叫 `view`，只在服务端实现。** 契约在 `src/shared/contract/view.ts`，不进桌面 IPC 契约表（`src/shared/contract/index.ts`）。桌面与网页渲染层不调用它，而是直接使用同一份共享纯逻辑；规则只有一份实现，调用方式按端不同。
2. **规则搬进 `src/shared`，渲染层迁完调用方后删除原文件。** 有 I/O 的规则改为依赖注入（豆瓣详情、TMDB 请求由调用方传入）：渲染层传 `window.api.online.*`，服务端传引擎调用（`ServerEngine.invoke`）。
3. **结果类型用 `src/shared/view/schema.ts` 的小型描述定义。** 一个描述值同时推导出 TS 类型（`Infer<typeof X>`），并由 `scripts/gen-view-kotlin.ts` 生成 Kotlin 数据类和基于 `org.json` 的解析函数，输出到 `android/app/src/main/kotlin/com/yingbox/android/view/ViewModels.kt`，生成文件提交到仓库。`tests/view-kotlin.test.ts` 重新生成并与仓库里的文件比较，不一致即失败，这就是「类型漂移时构建失败」。不引入新依赖；ADR-0028 提到的 JSON Schema 暂不生成，没有消费方，等有了再加。
4. **视图接口不因局部失败整体失败。** 每一行独立取数，某行失败就省略这一行（或返回 `null`），接口照常返回其余部分；整体失败只在服务端自身出错时出现。
5. **图片地址由服务端换成本服务的缩略图路径**（`/media/thumb?w=&src=`），原生端拼上服务地址、带令牌请求，防盗链 Referer 由服务端补（`shared/net/media-referer.ts`）。
6. **第一个接口 `view.home()`**：首页里不依赖播放记录的部分，按顺序为热门电影、热门剧集两行（豆瓣第一页，前 5 部补豆瓣详情，再用 TMDB 补海报）、榜单行（口碑榜，失败退回热门电影前 10）、按类型浏览、精选片单。服务端缓存 10 分钟。继续观看与 Hero 依赖播放记录，等 ADR-0028 决策 4 的服务端存储做好后加入同一接口。

## 后果

- 原生端拿到的是做好的行和卡，不需要知道豆瓣、TMDB 的细节；新增一行只改共享规则和服务端拼装，原生端按行类型渲染。
- 渲染层的这批规则换了位置和注入方式，现有测试跟着改导入路径，行为不变。函数的调用方直接改为从 `src/shared` 导入；`DoubanItem`、`TmdbDetail` 两个类型沿用 `features/online/types.ts` 已有的转出方式（与 `DetailImage` 相同），渲染层的类型导入不变。
- 首页有行没取到时（网络未就绪、豆瓣熔断）只缓存 30 秒，三行都在才缓存 10 分钟。片单卡的海报只用 TMDB 补，不取豆瓣详情。
- 生成器只支持描述里用到的形状（对象、数组、字符串、数字、布尔、可空、字面量联合）；需要更多形状时扩展生成器，不改用外部工具。
- Kotlin 端的解析代码是生成的，手写代码不直接解析视图 JSON。

## 否决方案

- **原生端直接调 `online` 原子接口，在 Kotlin 里重写拼装**：两套实现，正是 ADR-0028 要避免的。
- **继续用 `app` 域名并入桌面契约**：桌面 IPC 面会多出服务端才有的方法，主进程还要给它们写空实现。
- **ts-json-schema-generator + quicktype / kotlinx.serialization**：功能多于需要，增加两个开发依赖和一个 Gradle 插件，违反依赖基线。

## 补充（2026-11-04）：首页轮播的标志图

- `ViewCard` 与 `ViewHeroSlide` 加 `logo`（可空）。服务端在 TMDB 补全时记下 TMDB id 与类型，只给热门电影的前几张取 `/{movie|tv}/{id}/images` 的标志图（`shared/tmdb/logo.ts` 的 `pickLogo`：中文优先，其次英文、无文字的；SVG 与别的语言不要），换成本服务缩略图路径。没有令牌、取不到、出错都是 `null`，不影响首页。
- 安卓首页轮播有 `logo` 就显示标志图代替文字标题（与桌面端电影、电视剧详情头图一致），取不到退回文字；轮播里「继续观看」那一张不显示（继续观看有自己的一行）。
