<template>
  <!--
    「联网搜索」开关 —— 输入框左下角,模型选择旁边

    ⚠️ 这是**用户自己的偏好**,和「用哪个模型」是两件事:
       换模型不会改它(以前换模型会顺手把它关掉,用户会以为是自己关的)。
       但当前模型不支持联网时,勾了也没用 —— 这时用警示色提示,
       并在提示里说清楚「换个模型就恢复」。
  -->
  <a-tooltip :title="tip" placement="top">
    <button
      type="button"
      class="chip"
      :class="{ 'is-on': on && !disabled, 'is-warn': on && unsupported && !disabled, 'is-off': disabled }"
      :aria-disabled="disabled"
      @click="toggle"
    >
      <GlobalOutlined class="text-[13px]" />
      <span>联网搜索</span>
    </button>
  </a-tooltip>
</template>

<script setup>
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useModelStore } from '@/stores/model.js'

/**
 * 联网搜索开关的状态放在 store 里 —— 首页和聊天页共用同一份,
 * 而且刷新页面后还是开着(持久化,见 stores/model.js)。
 */
const modelStore = useModelStore()
const { webSearch } = storeToRefs(modelStore)

const props = defineProps({
  /**
   * 置灰(这次开不了联网搜索)
   *
   * <p>看图问答走的是多模态接口(/v9),后端不接 networkSearch ——
   *    摆成能点的样子就是「点了没反应」的假开关。
   */
  disabled: {
    type: Boolean,
    default: false,
  },
})

/** 开着没有 */
const on = computed(() => webSearch.value)

/**
 * 当前选的模型支不支持联网搜索
 *
 * <p>code 为空(用后端配的默认模型)时不知道 → 当作支持。
 */
const unsupported = computed(() => {
  const model = modelStore.models.find((m) => m.code === modelStore.code)
  return !!model && model.webSearch === false
})

/** 悬停提示 */
const tip = computed(() => {
  if (props.disabled) return '看图问答走多模态接口,本次不联网'
  if (on.value && unsupported.value) return '这个模型不支持联网搜索,本次不会联网(换个模型就恢复)'
  if (unsupported.value) return '这个模型不支持联网搜索'
  return '让模型联网查最新资料'
})

/** 开 / 关 —— 只改用户自己的偏好,跟选了哪个模型无关 */
const toggle = () => {
  if (props.disabled) return
  modelStore.toggleWebSearch()
}
</script>
