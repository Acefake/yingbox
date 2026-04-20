/**
 * 电影背景管理 Composable
 * 处理全局背景图控制
 */
import { inject, watch } from 'vue'
import { useSelectionStore } from '@/stores/selection-store'
import { useMediaProcessing } from '@/composables/use-media-processing'

interface AppLayoutMethods {
  setGlobalBackground: (imageUrl: string, overlayColor: string) => void
  clearGlobalBackground: () => void
}

export const useMovieBackground = () => {
  const selectionStore = useSelectionStore()
  const appLayoutMethods = inject('appLayoutMethods') as
    | AppLayoutMethods
    | undefined

  // 媒体处理
  const { posterImageDataUrl, fanartImageDataUrl, movieInfo } =
    useMediaProcessing(() => selectionStore.selectedItem)

  /**
   * 监听背景图变化，控制全局背景
   */
  watch(
    [() => selectionStore.selectedItem, fanartImageDataUrl],
    ([newSelectedItem, newFanartImageDataUrl]) => {
      if (appLayoutMethods) {
        if (newSelectedItem && newFanartImageDataUrl) {
          appLayoutMethods.setGlobalBackground(
            newFanartImageDataUrl,
            'rgba(17, 24, 39, 0.2)'
          )
        } else {
          appLayoutMethods.clearGlobalBackground()
        }
      }
    },
    { immediate: true }
  )

  return {
    // 媒体数据
    posterImageDataUrl,
    fanartImageDataUrl,
    movieInfo,
  }
}
