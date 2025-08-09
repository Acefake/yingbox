import { ref, type Ref } from 'vue'

// 菜单项接口
export interface MenuItem {
  id: string
  label: string
  icon?: string
  shortcut?: string
  action?: () => void
  disabled?: boolean
  divider?: boolean
}

// 右键菜单组合式函数
export function useContextMenu(): {
  menuVisible: Ref<boolean>
  menuX: Ref<number>
  menuY: Ref<number>
  currentMenuItems: Ref<MenuItem[]>
  showMenu: (event: MouseEvent, menuItems: MenuItem[]) => void
  hideMenu: () => void
  handleMenuItemClick: (item: MenuItem) => void
  createMenuItem: (
    id: string,
    label: string,
    options?: Partial<Omit<MenuItem, 'id' | 'label'>>
  ) => MenuItem
  createDivider: (id: string) => MenuItem
  commonMenuItems: {
    open: (action?: () => void) => MenuItem
    rename: (action?: () => void) => MenuItem
    copy: (action?: () => void) => MenuItem
    cut: (action?: () => void) => MenuItem
    paste: (action?: () => void) => MenuItem
    delete: (action?: () => void) => MenuItem
    view: (action?: () => void) => MenuItem
    preview: (action?: () => void) => MenuItem
    edit: (action?: () => void) => MenuItem
    download: (action?: () => void) => MenuItem
    share: (action?: () => void) => MenuItem
    properties: (action?: () => void) => MenuItem
  }
} {
  // 菜单状态
  const menuVisible = ref(false)
  const menuX = ref(0)
  const menuY = ref(0)
  const currentMenuItems = ref<MenuItem[]>([])

  // 显示菜单
  const showMenu = (event: MouseEvent, menuItems: MenuItem[]): void => {
    event.preventDefault()
    menuX.value = event.clientX
    menuY.value = event.clientY
    currentMenuItems.value = menuItems
    menuVisible.value = true
  }

  // 隐藏菜单
  const hideMenu = (): void => {
    menuVisible.value = false
    currentMenuItems.value = []
  }

  // 处理菜单项点击
  const handleMenuItemClick = (item: MenuItem): void => {
    if (item.disabled) return

    if (item.action) {
      item.action()
    }
    hideMenu()
  }

  // 创建常用菜单项
  const createMenuItem = (
    id: string,
    label: string,
    options: Partial<Omit<MenuItem, 'id' | 'label'>> = {}
  ): MenuItem => {
    return {
      id,
      label,
      ...options
    }
  }

  // 创建分割线
  const createDivider = (id: string): MenuItem => {
    return {
      id,
      label: '',
      divider: true
    }
  }

  // 预定义的常用菜单项
  const commonMenuItems = {
    // 文件操作
    open: (action?: () => void) =>
      createMenuItem('open', '打开', {
        icon: 'fas fa-folder-open',
        shortcut: 'Enter',
        action
      }),

    rename: (action?: () => void) =>
      createMenuItem('rename', '重命名', {
        icon: 'fas fa-edit',
        shortcut: 'F2',
        action
      }),

    copy: (action?: () => void) =>
      createMenuItem('copy', '复制', {
        icon: 'fas fa-copy',
        shortcut: 'Ctrl+C',
        action
      }),

    cut: (action?: () => void) =>
      createMenuItem('cut', '剪切', {
        icon: 'fas fa-cut',
        shortcut: 'Ctrl+X',
        action
      }),

    paste: (action?: () => void) =>
      createMenuItem('paste', '粘贴', {
        icon: 'fas fa-paste',
        shortcut: 'Ctrl+V',
        action
      }),

    delete: (action?: () => void) =>
      createMenuItem('delete', '删除', {
        icon: 'fas fa-trash',
        shortcut: 'Delete',
        action
      }),

    // 查看操作
    view: (action?: () => void) =>
      createMenuItem('view', '查看详情', {
        icon: 'fas fa-eye',
        action
      }),

    preview: (action?: () => void) =>
      createMenuItem('preview', '预览', {
        icon: 'fas fa-search-plus',
        action
      }),

    // 编辑操作
    edit: (action?: () => void) =>
      createMenuItem('edit', '编辑', {
        icon: 'fas fa-edit',
        action
      }),

    // 下载操作
    download: (action?: () => void) =>
      createMenuItem('download', '下载', {
        icon: 'fas fa-download',
        action
      }),

    // 分享操作
    share: (action?: () => void) =>
      createMenuItem('share', '分享', {
        icon: 'fas fa-share',
        action
      }),

    // 属性
    properties: (action?: () => void) =>
      createMenuItem('properties', '属性', {
        icon: 'fas fa-cog',
        action
      })
  }

  return {
    // 状态
    menuVisible: menuVisible as Ref<boolean>,
    menuX: menuX as Ref<number>,
    menuY: menuY as Ref<number>,
    currentMenuItems: currentMenuItems as Ref<MenuItem[]>,

    // 方法
    showMenu,
    hideMenu,
    handleMenuItemClick,
    createMenuItem,
    createDivider,

    // 预定义菜单项
    commonMenuItems
  }
}

// 文件类型菜单预设
export function useFileContextMenu(): ReturnType<typeof useContextMenu> & {
  createFileMenu: (
    file: { name: string; type: string },
    callbacks?: {
      onOpen?: () => void
      onRename?: () => void
      onCopy?: () => void
      onCut?: () => void
      onDelete?: () => void
      onProperties?: () => void
    }
  ) => MenuItem[]
} {
  const contextMenu = useContextMenu()

  const createFileMenu = (
    file: { name: string; type: string },
    callbacks: {
      onOpen?: () => void
      onRename?: () => void
      onCopy?: () => void
      onCut?: () => void
      onDelete?: () => void
      onProperties?: () => void
    } = {}
  ): MenuItem[] => {
    return [
      contextMenu.commonMenuItems.open(callbacks.onOpen),
      contextMenu.commonMenuItems.rename(callbacks.onRename),
      contextMenu.createDivider('divider1'),
      contextMenu.commonMenuItems.copy(callbacks.onCopy),
      contextMenu.commonMenuItems.cut(callbacks.onCut),
      contextMenu.createDivider('divider2'),
      contextMenu.commonMenuItems.delete(callbacks.onDelete),
      contextMenu.createDivider('divider3'),
      contextMenu.commonMenuItems.properties(callbacks.onProperties)
    ]
  }

  return {
    ...contextMenu,
    createFileMenu
  }
}

// 表格行菜单预设
export function useTableContextMenu(): ReturnType<typeof useContextMenu> & {
  createTableRowMenu: (
    item: { id: number; status?: string },
    callbacks?: {
      onView?: () => void
      onEdit?: () => void
      onToggleStatus?: () => void
      onDelete?: () => void
    }
  ) => MenuItem[]
} {
  const contextMenu = useContextMenu()

  const createTableRowMenu = (
    item: { id: number; status?: string },
    callbacks: {
      onView?: () => void
      onEdit?: () => void
      onToggleStatus?: () => void
      onDelete?: () => void
    } = {}
  ): MenuItem[] => {
    return [
      contextMenu.commonMenuItems.view(callbacks.onView),
      contextMenu.commonMenuItems.edit(callbacks.onEdit),
      contextMenu.createDivider('divider1'),
      contextMenu.createMenuItem('toggle-status', item.status === 'active' ? '停用' : '激活', {
        icon: item.status === 'active' ? 'fas fa-pause' : 'fas fa-play',
        action: callbacks.onToggleStatus
      }),
      contextMenu.createDivider('divider2'),
      contextMenu.commonMenuItems.delete(callbacks.onDelete)
    ]
  }

  return {
    ...contextMenu,
    createTableRowMenu
  }
}
