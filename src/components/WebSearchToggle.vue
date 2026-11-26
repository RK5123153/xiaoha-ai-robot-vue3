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
      :class="{ 'is-on': on, 'is-warn': on && unsupported }"
      @click="toggle"
    >
      <GlobalOutlined class="text-[13px]" />
      <span>联网搜索</span>
    </button>
  </a-tooltip>
</template>

<script setup>
import { computed } from 'vue'
import { modelState } from '@/utils/chat-store.js'

/** 开着没有 */
const on = computed(() => modelState.webSearch)

/**
 * 当前选的模型支不支持联网搜索
 *
 * <p>code 为空(用后端配的默认模型)时不知道 → 当作支持。
 */
const unsupported = computed(() => {
  const model = modelState.models.find((m) => m.code === modelState.code)
  return !!model && model.webSearch === false
})

/** 悬停提示 */
const tip = computed(() => {
  if (on.value && unsupported.value) return '这个模型不支持联网搜索,本次不会联网(换个模型就恢复)'
  if (unsupported.value) return '这个模型不支持联网搜索'
  return '让模型联网查最新资料'
})

/** 开 / 关 —— 只改用户自己的偏好,跟选了哪个模型无关 */
const toggle = () => {
  modelState.webSearch = !modelState.webSearch
}
</script>
