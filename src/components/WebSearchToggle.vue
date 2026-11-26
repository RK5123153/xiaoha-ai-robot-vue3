<template>
  <!--
    「联网搜索」开关 —— 输入框左下角,模型选择旁边

    ⚠️ 用 aria-disabled 而不是 disabled:
       disabled 的按钮在浏览器里**不派发鼠标事件**,antd 的 Tooltip 靠的就是这些事件
       → 灰着的按钮反而**弹不出**「为什么不能用」的说明,而这恰恰是最需要说明的时候。
       aria-disabled 只改语义,事件照常派发:提示能弹,点击由代码拦掉。
  -->
  <a-tooltip :title="tip" placement="top">
    <button
      type="button"
      class="chip"
      :class="{ 'is-on': modelState.webSearch }"
      :aria-disabled="unsupported"
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

/** 当前选的模型(可能是空 = 用后端默认) */
const model = computed(() => modelState.models.find((m) => m.code === modelState.code))

/**
 * 这个模型是不是明确不支持联网搜索
 *
 * <p>⚠️ 只有**明确知道**不支持时才拦:
 *    后端没给模型清单时(modelState.models 是空的),别把联网搜索锁死 ——
 *    那等于让用户彻底用不了这个功能。
 */
const unsupported = computed(() => !!model.value && model.value.webSearch === false)

/** 悬停提示 */
const tip = computed(() => {
  if (unsupported.value) return '这个模型不支持联网搜索'
  return '让模型联网查最新资料'
})

/** 开 / 关 */
const toggle = () => {
  if (unsupported.value) return
  modelState.webSearch = !modelState.webSearch
}
</script>
