/** 两个画面搜索入口共用的本次会话范围，不影响索引设置。 */
import { ref } from 'vue'
import type { VisualSearchSource } from '../../../../../shared/library/ipc'
export const visualSearchSource = ref<VisualSearchSource>('all')
