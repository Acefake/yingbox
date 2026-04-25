import type { Directive } from 'vue'

const handler = (e: WheelEvent) => {
  const el = e.currentTarget as HTMLElement
  if (e.deltaY === 0) return
  e.preventDefault()
  el.scrollLeft += e.deltaY
}

export const vScrollX: Directive<HTMLElement> = {
  mounted(el) {
    el.addEventListener('wheel', handler, { passive: false })
  },
  beforeUnmount(el) {
    el.removeEventListener('wheel', handler)
  },
}
