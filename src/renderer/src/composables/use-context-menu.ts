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
