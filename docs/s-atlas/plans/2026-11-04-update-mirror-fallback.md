# 更新下载多源回退 Implementation Plan

> **执行方式：** 仅写计划，不授权实现。用户选定 executing-plans 或 subagent-driven-development 后再动手。步骤使用复选框。

规格：[2026-11-04-update-mirror-fallback-design.md](../specs/2026-11-04-update-mirror-fallback-design.md)

**Goal:** 官方 GitHub 不可达时，桌面 / 安卓 / NAS 经 `gh-proxy.com` 白名单改写回退完成检查与下载，摘要校验不变。

**Architecture:** `src/shared/release` 提供纯函数候选 URL 与可重试判定；桌面更新器与 `githubReleases` 共用回退拉取；安卓 Kotlin 用同构规则对 `ViewAppUpdate.url` 依次下载。新 ADR-0046 部分取代 ADR-0037「不默认引入第三方代理」。

**Tech Stack:** TypeScript（shared / main / server）、Vitest、Kotlin 单元测试（android `src/test`）

**验证与授权：** 验证第 2 档；适用 TDD（先写失败测试）。未授权提交则不 commit。

## Global Constraints

- 只内置前缀 `https://gh-proxy.com/`；可改写主机仅 `api.github.com`、`github.com`、`objects.githubusercontent.com`
- 改写形式：`https://gh-proxy.com/` + 原始完整 URL（含 path/query，无多余斜杠拼接错误）
- `YINGBOX_ANDROID_RELEASES_URL` 已设置时：只请求该地址，不做镜像回退
- 仅网络错误 / 超时 / 429 / 5xx 换源；其它 4xx 不换源
- 下载必须 HTTPS；摘要失败丢弃临时文件并试下一候选
- 单文件 ≤ 400 行；不用 `any`；函数声明返回类型；文案只写最终状态
- 每个任务结束跑本任务测试；整计划结束跑相关测试并 typecheck 触及模块
- 不提交，除非用户明确授权

---

### Task 1: 共享镜像纯规则

**Files:**
- Create: `src/shared/release/mirrors.ts`
- Create: `tests/release-mirrors.test.ts`

**Interfaces:**
- Produces:
  - `GITHUB_MIRROR_PREFIX = 'https://gh-proxy.com/'`（导出常量）
  - `isGithubMirrorHost(host: string): boolean`
  - `mirrorCandidates(url: string): string[]` — 非法/非 https 返回 `[]`；非白名单主机返回 `[url]`；白名单返回 `[url, prefix+url]`
  - `shouldTryNextMirror(status: number | null, error: unknown): boolean` — `status` 为 null（网络层失败）、429、或 ≥500 为 true；其它有状态码为 false

- [ ] **Step 1: Write the failing test**

在 `tests/release-mirrors.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import {
  GITHUB_MIRROR_PREFIX,
  isGithubMirrorHost,
  mirrorCandidates,
  shouldTryNextMirror,
} from '../src/shared/release/mirrors'

describe('release mirrors', () => {
  it('白名单主机：官方在前，随后 gh-proxy 完整 URL 改写', () => {
    const api =
      'https://api.github.com/repos/Acefake/yingbox/releases?per_page=30'
    expect(mirrorCandidates(api)).toEqual([
      api,
      `${GITHUB_MIRROR_PREFIX}${api}`,
    ])
    const asset =
      'https://github.com/Acefake/yingbox/releases/download/v1.0.4/x.exe'
    expect(mirrorCandidates(asset)[1]).toBe(`${GITHUB_MIRROR_PREFIX}${asset}`)
    expect(
      mirrorCandidates(
        'https://objects.githubusercontent.com/github-production-release-asset-2e65be/x'
      )
    ).toHaveLength(2)
  })

  it('非白名单或不合法地址不套镜像', () => {
    expect(mirrorCandidates('https://example.com/a')).toEqual([
      'https://example.com/a',
    ])
    expect(mirrorCandidates('http://github.com/a')).toEqual([])
    expect(mirrorCandidates('not-a-url')).toEqual([])
  })

  it('可重试判定', () => {
    expect(shouldTryNextMirror(null, new TypeError('fetch failed'))).toBe(true)
    expect(shouldTryNextMirror(429, null)).toBe(true)
    expect(shouldTryNextMirror(503, null)).toBe(true)
    expect(shouldTryNextMirror(404, null)).toBe(false)
    expect(shouldTryNextMirror(403, null)).toBe(false)
    expect(isGithubMirrorHost('api.github.com')).toBe(true)
    expect(isGithubMirrorHost('evil.com')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/release-mirrors.test.ts`  
Expected: FAIL（模块不存在）

- [ ] **Step 3: Write minimal implementation**

`src/shared/release/mirrors.ts`：实现上述导出；用 `URL` 解析；`protocol !== 'https:'` → `[]`；host 用 `isGithubMirrorHost`。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/release-mirrors.test.ts`  
Expected: PASS

- [ ] **Step 5: Self-review before delivery**

按 code-style 审本任务 diff。

- [ ] **Step 6: Independent review before delivery**

派只读评审（小范围：新文件 + 测试）。

- [ ] **Step 7: Commit only when authorized**

未授权则跳过。

---

### Task 2: 共享 `fetchFirstOk` 回退拉取

**Files:**
- Create: `src/shared/release/fetch-first.ts`
- Create: `tests/release-fetch-first.test.ts`

**Interfaces:**
- Consumes: `mirrorCandidates`、`shouldTryNextMirror`（Task 1）
- Produces:
  - `fetchFirstOk(urls: readonly string[], fetchImpl: typeof fetch, init?: RequestInit): Promise<Response>`
  - 空 `urls` → throw `Error('没有可用的更新地址')`
  - 某个候选得到可重试失败则试下一个；不可重试（如 404）立即 throw，带 HTTP 状态
  - 全部失败 → throw 最后一个错误（消息保留可读中文或底层 message）

- [ ] **Step 1: Write the failing test**

```ts
it('官方 200 时不请求镜像', async () => {
  const calls: string[] = []
  const fetchImpl = (async (input: RequestInfo | URL) => {
    calls.push(String(input))
    return new Response('[]', { status: 200 })
  }) as typeof fetch
  const urls = [
    'https://api.github.com/repos/x/y/releases',
    'https://gh-proxy.com/https://api.github.com/repos/x/y/releases',
  ]
  await fetchFirstOk(urls, fetchImpl)
  expect(calls).toEqual([urls[0]])
})

it('官方网络失败后走镜像', async () => {
  const calls: string[] = []
  const fetchImpl = (async (input: RequestInfo | URL) => {
    calls.push(String(input))
    if (calls.length === 1) throw new TypeError('fetch failed')
    return new Response('[]', { status: 200 })
  }) as typeof fetch
  const urls = ['https://api.github.com/a', 'https://gh-proxy.com/https://api.github.com/a']
  await fetchFirstOk(urls, fetchImpl)
  expect(calls).toEqual(urls)
})

it('404 不换源', async () => {
  const fetchImpl = (async () => new Response('no', { status: 404 })) as typeof fetch
  await expect(
    fetchFirstOk(['https://api.github.com/a', 'https://gh-proxy.com/https://api.github.com/a'], fetchImpl)
  ).rejects.toThrow(/404/)
})
```

- [ ] **Step 2: Run test — expect FAIL**

`pnpm vitest run tests/release-fetch-first.test.ts`

- [ ] **Step 3: Minimal implementation**

循环 `urls`；`try/catch`；若有 `response` 且 `!ok`，用 `shouldTryNextMirror(status)` 决定是否继续；`ok` 则 return。

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5–7:** 自审、独立评审、授权才提交

---

### Task 3: 接入桌面更新器

**Files:**
- Modify: `src/main/updater/desktop-updater.ts`
- Modify: `tests/desktop-updater.test.ts`

**Interfaces:**
- Consumes: `mirrorCandidates`、`fetchFirstOk`、`shouldTryNextMirror`
- `releases()`：`fetchFirstOk(mirrorCandidates(RELEASES_URL), deps.fetch, { headers, signal })`，再 `json()`
- `fetchInstaller`：对 `mirrorCandidates(update.url)` 依次尝试现有下载逻辑；某候选出现可重试失败（网络/5xx/429）或摘要失败则试下一个；摘要失败也试下一个（规格：失败丢弃并试下一候选）；不可重试 HTTP 4xx（非 429）停止该次 download 报错

- [ ] **Step 1: Extend failing tests in `tests/desktop-updater.test.ts`**

```ts
it('检查更新：官方失败后镜像成功', async () => {
  const calls: string[] = []
  const updater = setup({
    fetch: (async (input: string | URL | Request) => {
      const u = String(input)
      calls.push(u)
      if (u.startsWith('https://api.github.com')) throw new TypeError('fetch failed')
      if (u.includes('gh-proxy.com') && u.includes('api.github.com'))
        return new Response(JSON.stringify(releases()))
      return new Response(new Uint8Array(BODY))
    }) as typeof fetch,
  })
  expect((await updater.check()).success).toBe(true)
  expect(calls.some(c => c.includes('gh-proxy.com'))).toBe(true)
})

it('下载：官方失败后镜像成功并校验通过', async () => {
  // check 走官方成功；download 时官方 asset throw，镜像返回 BODY
})
```

- [ ] **Step 2: Run — expect FAIL（行为未实现）**

`pnpm vitest run tests/desktop-updater.test.ts`

- [ ] **Step 3: Implement wiring**

改 `releases()` 与 `fetchInstaller`；保持缓存、进度、静默安装不变。注意：假 `fetch` 旧测试用 `startsWith('https://api.github.com')` 区分列表与文件——镜像 URL 以 `https://gh-proxy.com/https://api...` 开头，需一并识别为列表响应（或按 path 含 `/releases` 判断）。同步更新现有 setup 里的 `fetch` 分支，避免回归。

- [ ] **Step 4: Run — expect PASS**（含原有用例）

- [ ] **Step 5–7:** 自审、评审、授权才提交

---

### Task 4: 接入 `githubReleases`（安卓 Node / NAS）

**Files:**
- Modify: `src/server/view/app-update.ts`
- Modify: `tests/android-release.test.ts`

**Interfaces:**
- `githubReleases(url?)`：
  - 若 `url` 为内置 DEFAULT：每一页用 `fetchFirstOk(mirrorCandidates(pageHref), fetch, …)`
  - 若 `url` 不是 DEFAULT（含 env 覆盖）：只请求该地址，不套镜像
  - 分页 `Link` 的 next：仍校验 origin/pathname 与**原始 endpoint**一致（官方 API 的 origin）；若 next 是官方 `api.github.com`，请求时再走 `mirrorCandidates(next)`，这样官方挂了时分页也能镜像
  - 注释更新为说明默认多源回退

- [ ] **Step 1: Failing tests**

```ts
it('默认地址：官方失败后经 gh-proxy 拉到列表', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch')
  fetch.mockImplementation(async (input) => {
    const u = String(input)
    if (u.startsWith('https://api.github.com')) throw new TypeError('fetch failed')
    if (u.startsWith('https://gh-proxy.com/https://api.github.com'))
      return new Response(JSON.stringify([
        release('v0.2.0', [asset('yingbox-android-0.2.0-arm64-v8a.apk')]),
      ]))
    throw new Error(u)
  })
  try {
    const list = await githubReleases()()
    expect(pickAndroidUpdate(list, '0.1.0', ['arm64-v8a'])?.version).toBe('0.2.0')
  } finally {
    fetch.mockRestore()
  }
})

it('自定义非 GitHub RELEASES_URL 不请求 gh-proxy', async () => {
  const url = 'https://example.com/releases.json'
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]'))
  try {
    await githubReleases(url)()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(String(fetch.mock.calls[0]![0])).toBe(url)
  } finally {
    fetch.mockRestore()
  }
})
```

- [ ] **Step 2–4:** 失败 → 实现 → 通过

`pnpm vitest run tests/android-release.test.ts`

- [ ] **Step 5–7:** 自审、评审、授权才提交

---

### Task 5: 安卓 Kotlin 下载候选

**Files:**
- Create: `android/app/src/main/kotlin/com/yingbox/android/update/ReleaseMirrors.kt`
- Create: `android/app/src/test/kotlin/com/yingbox/android/update/ReleaseMirrorsTest.kt`
- Modify: `android/app/src/main/kotlin/com/yingbox/android/update/AppUpdater.kt`

**Interfaces:**
- `object ReleaseMirrors`：
  - `const val PREFIX = "https://gh-proxy.com/"`
  - `fun candidates(url: String): List<String>` — 行为与 TS `mirrorCandidates` 一致
- `AppUpdater.download`：`for (address in ReleaseMirrors.candidates(update.url))` 调用现有 `openDownload`；捕获可重试失败与校验失败后试下一个；全部失败抛最后错误。`ViewAppUpdate` 形状不变。

- [ ] **Step 1: Kotlin unit tests for candidates**（与 Task 1 用例对齐）

- [ ] **Step 2: Run**

`cd android && .\gradlew.bat :app:testDebugUnitTest --tests com.yingbox.android.update.ReleaseMirrorsTest`  
Expected: FAIL until implemented

- [ ] **Step 3: Implement `ReleaseMirrors` + wire `AppUpdater.download`**

可重试：`IOException`、连接失败；HTTP 经 `openDownload` 已抛的消息含 5xx/429 时试下一个；404/403 不换源。摘要失败试下一个。

- [ ] **Step 4: Re-run unit test PASS；必要时再跑相关 update 测试（若无则仅 ReleaseMirrorsTest）**

- [ ] **Step 5–7:** 自审、评审、授权才提交

---

### Task 6: ADR-0046 与索引

**Files:**
- Create: `docs/adr/0046-update-mirror-fallback.md`
- Modify: `docs/adr/0037-android-release-and-update.md`（备注：第三方代理条款被 0046 部分取代）
- Modify: `AGENTS.md` ADR 列表追加 0046 一行（注意 context-budget；必要时只加短链）
- Modify: `CLAUDE.md` 仅当其中有 ADR 索引且必须同步时（否则不改，避免涨预算）

**内容要点（ADR）：**
- 背景：国内直连失败；实测 `gh-proxy.com`；零运维
- 决策：官方优先 + 白名单改写；摘要仍强制；自定义 RELEASES_URL 不回退
- 后果：依赖公共反代可用性
- 否决：仅可配置源、多镜像堆砌、jsDelivr 当 API

- [ ] **Step 1: 写 ADR 与交叉引用**（第 0 档文档：只检查 diff，不新写测试）
- [ ] **Step 2: `pnpm vitest run tests/dev-gates/context-budget.test.ts`** — 若超预算，缩短 AGENTS 行或移细节到 ADR
- [ ] **Step 3–4:** 自审 diff；轻量评审；授权才提交

---

### Task 7: 汇总验证

- [ ] **Step 1: 跑相关测试**

```bash
pnpm vitest run tests/release-mirrors.test.ts tests/release-fetch-first.test.ts tests/desktop-updater.test.ts tests/android-release.test.ts
pnpm typecheck:node
cd android && .\gradlew.bat :app:testDebugUnitTest --tests com.yingbox.android.update.ReleaseMirrorsTest
```

Expected: 全部 PASS

- [ ] **Step 2: 手工 spot-check（有设备时）**

无代理环境：触发检查更新；确认日志或抓包在官方失败时出现 `gh-proxy.com`。

- [ ] **Step 3: 交付说明**

列出改动文件、测试结果、未授权则提示可提交。

---

## 不在本计划内

- 设置页镜像开关 / 多镜像配置 UI
- macOS 应用内更新
- 发布物签名公钥
- 更换或新增第二个公共反代（需新实测 + 改白名单）
