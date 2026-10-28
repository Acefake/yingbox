// @vitest-environment jsdom
import { effectScope, nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { expect, it } from 'vitest'
import { useOnlineDetailRoute } from '../src/renderer/src/features/online/composables/use-online-detail-route'

it('详情加入历史，后退保留浏览条件，前进恢复条目', async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: {} },
      { path: '/movie', component: {} },
    ],
  })
  await router.push('/?browse=genre&genre=科幻')
  const scope = effectScope()
  const detail = scope.run(() => useOnlineDetailRoute(router))!
  await detail.open({
    vod_name: '测试影片',
    vod_id: '1',
    vod_pic: 'https://example.com/poster.jpg',
  })
  expect(detail.item.value?.vod_name).toBe('测试影片')
  expect(detail.item.value?.vod_pic).toBe('https://example.com/poster.jpg')
  expect(router.currentRoute.value.query.genre).toBe('科幻')
  await detail.open({ vod_name: '另一部影片' })
  expect(detail.item.value?.vod_name).toBe('另一部影片')
  router.back()
  await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
  expect(detail.item.value).toBeNull()
  expect(router.currentRoute.value.query.genre).toBe('科幻')
  router.forward()
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(detail.item.value?.vod_name).toBe('另一部影片')
  await router.push('/movie')
  expect(detail.item.value).toBeNull()
  scope.stop()
})
