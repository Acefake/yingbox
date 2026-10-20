import { getCurrentInstance } from 'vue'

/**
 * 判断父组件是否用 v-model（或 :model-value / @update:model-value）绑定了当前组件。
 *
 * 表单控件支持两种用法：
 * - 受控：父组件写 v-model，组件内部用 Vue 原生的 v-model 指令驱动原生控件
 *   （保留输入法组合、number 类型转换、select 的选项值类型等行为）；
 * - 透传：父组件直接写 :value / :checked + @input / @change，组件把这些原样交给原生控件，
 *   事件里的 $event.target 仍是原生元素。
 *
 * 只能在 setup 里调用；同一个实例的绑定方式不会在运行中改变。
 */
export function hasModelBinding(): boolean {
  const props = getCurrentInstance()?.vnode.props
  if (!props) return false
  return (
    'modelValue' in props ||
    'model-value' in props ||
    'onUpdate:modelValue' in props
  )
}
