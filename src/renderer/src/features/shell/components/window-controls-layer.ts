/**
 * 遮罩空白处保留窗口按钮；遇到弹层内容时让位，避免遮挡弹层操作。
 * 原生模态框打开时移入它内部，避免按钮被 inert 禁用。
 * 返回清理函数，供宿主卸载前撤回观察并恢复按钮的挂载位置。
 */
export function installWindowControlsLayer(layer: HTMLElement): () => void {
  const dialogs: HTMLDialogElement[] = []
  let current: HTMLElement | undefined
  const sync = (records: MutationRecord[] = []): void => {
    for (const record of records) {
      if (
        record.attributeName === 'open' &&
        record.target instanceof HTMLDialogElement
      ) {
        const index = dialogs.indexOf(record.target)
        if (index >= 0) dialogs.splice(index, 1)
        if (record.target.matches(':modal')) dialogs.push(record.target)
      }
    }
    for (const dialog of document.querySelectorAll<HTMLDialogElement>(
      'dialog:modal'
    )) {
      if (!dialogs.includes(dialog)) dialogs.push(dialog)
    }
    const active = dialogs.filter(
      dialog => dialog.isConnected && dialog.matches(':modal')
    )
    dialogs.splice(0, dialogs.length, ...active)
    const parent = dialogs.at(-1) ?? document.body
    if (parent !== current) {
      if (layer.matches(':popover-open')) layer.hidePopover()
      if (layer.parentElement !== parent) parent.append(layer)
    }
    current = parent
    if (!layer.matches(':popover-open')) layer.showPopover()
    if (coversOverlayContent(layer)) layer.hidePopover()
  }
  const observer = new MutationObserver(sync)
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['open', 'class', 'style'],
  })
  const resize = (): void => sync()
  const toggle = (event: Event): void => {
    if (event.target !== layer) sync()
  }
  window.addEventListener('resize', resize)
  document.addEventListener('toggle', toggle, true)
  document.addEventListener('scroll', resize, true)
  document.addEventListener('transitionend', resize, true)
  document.addEventListener('animationend', resize, true)
  sync()
  return () => {
    observer.disconnect()
    window.removeEventListener('resize', resize)
    document.removeEventListener('toggle', toggle, true)
    document.removeEventListener('scroll', resize, true)
    document.removeEventListener('transitionend', resize, true)
    document.removeEventListener('animationend', resize, true)
    if (layer.matches(':popover-open')) layer.hidePopover()
    document.body.append(layer)
  }
}

/** 按实际矩形检测弹层内容；穿透点击的全屏定位容器只检查其子内容。 */
function coversOverlayContent(layer: HTMLElement): boolean {
  const rect = layer.getBoundingClientRect()
  const overlaps = (element: Element): boolean => {
    if (layer.contains(element)) return false
    const style = getComputedStyle(element)
    if (style.display === 'none' || style.visibility === 'hidden') return false
    if (style.pointerEvents === 'none')
      return Array.from(element.children).some(overlaps)
    const bounds = element.getBoundingClientRect()
    return (
      bounds.width > 0 &&
      bounds.height > 0 &&
      rect.left < bounds.right &&
      rect.right > bounds.left &&
      rect.top < bounds.bottom &&
      rect.bottom > bounds.top
    )
  }
  return Array.from(
    document.querySelectorAll(
      'dialog[open], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [popover], .dialog-titlebar'
    )
  ).some(overlaps)
}
