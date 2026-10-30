/** 从实际输出模块检查 NAS 边界，避免共享组件把完整版本功能带回产物。 */
import type { Plugin } from 'vite'

/** 只在 NAS 模式使用；发现被裁剪模块时终止构建。 */
export function nasBuildGuard(target: 'web' | 'server'): Plugin {
  const forbidden =
    target === 'web'
      ? /\/src\/renderer\/src\/features\/(assistant|live|calendar|av)\/|\/features\/online\/views\/|\/features\/online\/components\/(SearchTab|VodBrowse|DetailWindow|SourceManager|OnlineSourcesTab)|\/features\/online\/composables\/(use-online-search|use-vod-parser|cms-subscription)/
      : /\/src\/server\/(online\/|iptv\.ts)|\/src\/engine\/(node\.ts|download\/|online\/index\.ts)/
  return {
    name: 'nas-build-guard',
    generateBundle(_options, bundle) {
      const leaked = new Set<string>()
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue
        for (const id of Object.keys(chunk.modules)) {
          if (forbidden.test(id.replaceAll('\\', '/'))) leaked.add(id)
        }
      }
      if (leaked.size)
        this.error(`NAS 产物包含已裁剪模块：\n${[...leaked].join('\n')}`)
    },
  }
}
