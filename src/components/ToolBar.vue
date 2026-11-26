<template>
  <!--
    工具开关:勾上的工具才会发给模型(tools=datetime,amap)
    只有文字对话有:看图说话那条路(/v9)后端不接工具。

    ⚠️ 为什么要单独抽成组件:
       首页和聊天页的输入框下面都要有这一排,状态是**同一份**(存在 store 里)。
       之前它只写在聊天页里,于是从首页发消息时用户根本没机会勾工具 ——
       首页的推荐问题写着「需要勾选天气工具」,可页面上根本没有那个开关。
  -->
  <div v-if="toolState.list.length" class="tool-bar">
    <span class="tool-bar-label">工具</span>
    <a-tooltip
      v-for="t in toolState.list"
      :key="t.name"
      placement="top"
      :title="t.available === false ? (t.unavailableReason || t.description) : t.description"
    >
      <button
        type="button"
        class="chip"
        :class="{ 'is-on': toolState.selected.includes(t.name), 'is-off': t.available === false }"
        :aria-disabled="t.available === false"
        @click="toggleTool(t.name)"
      >{{ t.label || t.name }}</button>
    </a-tooltip>
  </div>
</template>

<script setup>
import { toolState, toggleTool } from '@/utils/chat-store.js'

/**
 * 不可用的工具(比如 GitHub 没配 PAT):灰着、点不动 —— 鼠标悬停能看到原因。
 *
 * <p>⚠️ 这里用 `aria-disabled` 而不是 `disabled`:
 *   `disabled` 的按钮在浏览器里**不派发鼠标事件**,antd 的 Tooltip 靠的就是这些事件
 *   → 一颗置灰的按钮反而**弹不出**「为什么不能用」的说明,而这恰恰是最需要说明的时候。
 *   `aria-disabled` 只改语义,事件照常派发:提示能弹,点击则由 toggleTool 拦掉。
 */
</script>

<style scoped>
.tool-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}

.tool-bar-label {
  font-size: 12px;
  color: #9ca3af;
}
</style>
