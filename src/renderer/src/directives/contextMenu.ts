import { DirectiveBinding, ObjectDirective } from 'vue'
import { MenuItem } from '../hooks/useContextMenu'

// 右键菜单指令配置接口
interface ContextMenuConfig<T = unknown> {
  menuItems: MenuItem[] | ((data: T) => MenuItem[])
  data?: T
  onItemClick?: (item: MenuItem, data: T) => void
  disabled?: boolean
}

// 菜单状态管理
class ContextMenuManager {
  private static instance: ContextMenuManager
  private menuElement: HTMLElement | null = null
  private isVisible = false
  private currentConfig: ContextMenuConfig | null = null
  private currentData: unknown = null

  static getInstance(): ContextMenuManager {
    if (!ContextMenuManager.instance) {
      ContextMenuManager.instance = new ContextMenuManager()
    }
    return ContextMenuManager.instance
  }

  private constructor() {
    this.createMenuElement()
    this.bindGlobalEvents()
  }

  private createMenuElement(): void {
    this.menuElement = document.createElement('div')
    this.menuElement.className = 'context-menu-wrapper'
    this.menuElement.style.cssText = `
      position: fixed;
      z-index: 9999;
      background: #2d3748;
      border: 1px solid #4a5568;
      border-radius: 6px;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.3);
      min-width: 180px;
      padding: 4px 0;
      font-size: 14px;
      color: #e2e8f0;
      display: none;
      user-select: none;
    `
    document.body.appendChild(this.menuElement)
  }

  private bindGlobalEvents(): void {
    document.addEventListener('click', this.hideMenu.bind(this))
    document.addEventListener('contextmenu', e => {
      if (!this.menuElement?.contains(e.target as Node)) {
        this.hideMenu()
      }
    })
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        this.hideMenu()
      }
    })
  }

  showMenu(x: number, y: number, config: ContextMenuConfig, data?: unknown): void {
    if (!this.menuElement || config.disabled) return

    this.currentConfig = config
    this.currentData = data || config.data

    const menuItems =
      typeof config.menuItems === 'function' ? config.menuItems(this.currentData) : config.menuItems

    this.renderMenuItems(menuItems)
    this.positionMenu(x, y)
    this.menuElement.style.display = 'block'
    this.isVisible = true
  }

  private renderMenuItems(items: MenuItem[]): void {
    if (!this.menuElement) return

    this.menuElement.innerHTML = ''

    items.forEach(item => {
      if (item.divider) {
        const divider = document.createElement('div')

        divider.style.cssText = `
          height: 1px;
          background-color: #4a5568;
          margin: 4px 0;
        `
        this.menuElement!.appendChild(divider)
        return
      }

      const menuItem = document.createElement('div')

      menuItem.className = 'menu-item'
      menuItem.style.cssText = `
        display: flex;
        align-items: center;
        padding: 8px 16px;
        cursor: ${item.disabled ? 'not-allowed' : 'pointer'};
        opacity: ${item.disabled ? '0.5' : '1'};
        transition: background-color 0.15s ease;
      `

      menuItem.innerHTML = `
        ${item.icon ? `<i class="${item.icon}" style="width: 16px; height: 16px; margin-right: 12px; flex-shrink: 0;"></i>` : ''}
        <span style="flex: 1;">${item.label}</span>
        ${item.shortcut ? `<span style="font-size: 12px; color: #a0aec0; margin-left: 12px;">${item.shortcut}</span>` : ''}
      `

      if (!item.disabled) {
        menuItem.addEventListener('mouseenter', () => {
          menuItem.style.backgroundColor = '#4a5568'
        })
        menuItem.addEventListener('mouseleave', () => {
          menuItem.style.backgroundColor = 'transparent'
        })
        menuItem.addEventListener('click', e => {
          e.stopPropagation()
          this.handleItemClick(item)
        })
      }

      this.menuElement!.appendChild(menuItem)
    })
  }

  private positionMenu(x: number, y: number): void {
    if (!this.menuElement) return

    // 先设置初始位置以获取尺寸
    this.menuElement.style.left = x + 'px'
    this.menuElement.style.top = y + 'px'

    const rect = this.menuElement.getBoundingClientRect()

    const viewportWidth = window.innerWidth

    const viewportHeight = window.innerHeight

    let newX = x
    let newY = y

    // 防止超出右边界
    if (rect.right > viewportWidth) {
      newX = viewportWidth - rect.width - 10
    }

    // 防止超出下边界
    if (rect.bottom > viewportHeight) {
      newY = viewportHeight - rect.height - 10
    }

    // 防止超出左边界和上边界
    newX = Math.max(10, newX)
    newY = Math.max(10, newY)

    this.menuElement.style.left = newX + 'px'
    this.menuElement.style.top = newY + 'px'
  }

  private handleItemClick(item: MenuItem): void {
    if (item.action) {
      item.action()
    }

    if (this.currentConfig?.onItemClick) {
      this.currentConfig.onItemClick(item, this.currentData)
    }

    this.hideMenu()
  }

  hideMenu(): void {
    if (this.menuElement && this.isVisible) {
      this.menuElement.style.display = 'none'
      this.isVisible = false
      this.currentConfig = null
      this.currentData = null
    }
  }
}

// 右键菜单指令
const contextMenu: ObjectDirective<HTMLElement, ContextMenuConfig> = {
  mounted(el: HTMLElement, binding: DirectiveBinding<ContextMenuConfig>) {
    const handleContextMenu = (event: MouseEvent): void => {
      event.preventDefault()
      event.stopPropagation()

      const manager = ContextMenuManager.getInstance()

      manager.showMenu(event.clientX, event.clientY, binding.value)
    }

    el.addEventListener('contextmenu', handleContextMenu)

    // 存储事件处理器以便后续清理
    ;(
      el as HTMLElement & { __contextMenuHandler?: (event: MouseEvent) => void }
    ).__contextMenuHandler = handleContextMenu
  },

  updated(): void {
    // 配置更新时不需要重新绑定事件，只需要更新配置
  },

  unmounted(el: HTMLElement) {
    const handler = (el as HTMLElement & { __contextMenuHandler?: (event: MouseEvent) => void })
      .__contextMenuHandler

    if (handler) {
      el.removeEventListener('contextmenu', handler)
      delete (
        el as HTMLElement & {
          __contextMenuHandler?: (event: MouseEvent) => void
        }
      ).__contextMenuHandler
    }
  },
}

export default contextMenu

export { ContextMenuManager, type ContextMenuConfig }
