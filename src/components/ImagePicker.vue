<template>
  <!--
    「添加图片」按钮 + 隐藏的 file input

    只负责「选文件」这一件事，选中之后把 File 往上传，
    校验、压缩、预览都由父组件做（那边才知道当前是不是「看图说话」模式）。
  -->
  <button
    type="button"
    class="pick-btn"
    :disabled="disabled"
    title="添加图片"
    aria-label="添加图片"
    @click="openPicker"
  >
    <SvgIcon name="image" customCss="w-4 h-4"></SvgIcon>
    <span class="text-xs">图片</span>
  </button>

  <!--
    accept="image/*" 只是给浏览器的过滤提示，不是一道安全边界 ——
    真正的类型校验在 utils/image.js 里做（拖拽进来的文件根本不过这个 input）。
  -->
  <input
    ref="fileInput"
    type="file"
    accept="image/*"
    class="hidden"
    @change="onChange"
  />
</template>

<script setup>
import { ref } from 'vue'
import SvgIcon from '@/components/SvgIcon.vue'

const props = defineProps({
  /** 正在发送 / 处理图片时禁用 */
  disabled: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['pick'])

const fileInput = ref(null)

const openPicker = () => {
  if (props.disabled) return
  fileInput.value?.click()
}

const onChange = (e) => {
  const file = e.target.files?.[0]
  // ⚠️ 清空 value：否则同一个文件第二次选不到
  //    （浏览器认为「没变化」，不会触发 change 事件）
  e.target.value = ''
  if (file) emit('pick', file)
}
</script>

<style scoped>
.pick-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border-radius: 8px;
  color: #6b7280;
  background: transparent;
  border: 1px solid #e5e7eb;
  cursor: pointer;
  transition: color 0.15s ease, background-color 0.15s ease;
}

.pick-btn:hover:not(:disabled) {
  color: #4d6bfe;
  background: rgba(77, 107, 254, 0.06);
}

.pick-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
