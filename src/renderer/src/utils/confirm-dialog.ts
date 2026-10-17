import { h } from 'vue'
import { Modal } from 'ant-design-vue'
import DialogTitlebar from '@/components/DialogTitlebar.vue'

/** Keep Ant's confirmation behavior while sharing the app dialog titlebar. */
export function confirmDialog(options: Parameters<typeof Modal.confirm>[0]) {
  return Modal.confirm({
    ...options,
    icon: null,
    wrapClassName: ['yb-confirm-dialog', options.wrapClassName].filter(Boolean).join(' '),
    title: h(DialogTitlebar, { icon: 'warning', closable: false }, {
      default: () => options.title,
    }),
  })
}
