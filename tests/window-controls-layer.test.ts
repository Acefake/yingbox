// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { installWindowControlsLayer } from '../src/renderer/src/features/shell/components/window-controls-layer'

const matches = HTMLElement.prototype.matches
const query = document.querySelectorAll.bind(document)
let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  dispose = undefined
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

it('窗口按钮跨模态框保持顶层与可交互的归属，关闭后回到页面', async () => {
  vi.spyOn(HTMLElement.prototype, 'matches').mockImplementation(function (
    this: HTMLElement,
    selector
  ) {
    if (selector === ':modal')
      return this instanceof HTMLDialogElement && this.open
    if (selector === ':popover-open') return this.hasAttribute('data-shown')
    return matches.call(this, selector)
  })
  vi.spyOn(document, 'querySelectorAll').mockImplementation(selector =>
    query(selector === 'dialog:modal' ? 'dialog[open]' : selector)
  )
  const layer = document.createElement('div')
  layer.showPopover = () => layer.setAttribute('data-shown', '')
  layer.hidePopover = () => layer.removeAttribute('data-shown')
  document.body.append(layer)
  dispose = installWindowControlsLayer(layer)
  expect(layer.matches(':popover-open')).toBe(true)
  vi.spyOn(layer, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(662, 0, 138, 32)
  )
  const panel = document.createElement('div')
  panel.setAttribute('role', 'menu')
  vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(750, 0, 10, 20)
  )
  document.body.append(panel)
  await Promise.resolve()
  await Promise.resolve()
  expect(layer.matches(':popover-open')).toBe(false)
  panel.remove()
  await Promise.resolve()
  await Promise.resolve()
  expect(layer.matches(':popover-open')).toBe(true)
  const first = document.createElement('dialog')
  const second = document.createElement('dialog')
  document.body.append(first, second)
  const settle = async (): Promise<void> => {
    await Promise.resolve()
    await Promise.resolve()
  }
  // 打开顺序与 DOM 顺序相反：按钮应跟随最后打开的模态框。
  second.open = true
  await settle()
  expect(layer.parentElement).toBe(second)
  first.open = true
  await settle()
  expect(layer.parentElement).toBe(first)
  expect(layer.matches(':popover-open')).toBe(true)
  first.open = false
  await settle()
  expect(layer.parentElement).toBe(second)
  second.remove()
  await settle()
  expect(layer.parentElement).toBe(document.body)
  dispose()
  dispose = undefined
  first.open = true
  await settle()
  expect(layer.parentElement).toBe(document.body)
  expect(layer.matches(':popover-open')).toBe(false)
})
