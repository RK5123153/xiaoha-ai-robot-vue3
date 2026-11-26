<template>
  <!--
    工具选择器 —— 一个「工具」小圆片,点开是一张勾选清单。

    ⚠️ 为什么不再平铺成一排圆片:
       工具是**后端说了算**的,以后只会越来越多(现在是 5 个)。
       平铺的话,一行放不下就得换行,输入框底部那条行会越来越乱。
       收成一个圆片 + 弹层之后,不管有 5 个还是 50 个,底栏永远就那么几个东西
       (工具 / 模型 / 联网搜索 / 图片 / 发送)—— 和 DeepSeek 那种「深度思考」圆片一个路子。

    <p>弹层用 antd 的 <a-popover>:遮罩、避让、点外面关闭这些都是现成的。
  -->
  <a-popover
    v-if="list.length"
    v-model:open="open"
    placement="topLeft"
    trigger="click"
    :disabled="disabled"
  >
    <template #content>
      <div class="tool-panel">
        <p class="tool-panel-title">工具</p>
        <label
          v-for="t in list"
          :key="t.name"
          class="tool-row"
          :class="{ 'is-off': t.available === false }"
        >
          <a-checkbox
            :checked="selected.includes(t.name)"
            :disabled="t.available === false"
            @change="() => toolStore.toggleTool(t.name)"
          />
          <span class="tool-name">{{ t.label || t.name }}</span>
          <!--
            ⚠️ 不可用的工具(比如 GitHub 没配 PAT)照样列出来,但标灰、勾不动,
            并且把原因写在这儿 —— 藏起来的话用户根本不知道为什么少了一个。
          -->
          <span class="tool-desc">{{ t.available === false ? (t.unavailableReason || t.description) : t.description }}</span>
        </label>
      </div>
    </template>

    <button
      type="button"
      class="chip"
      :class="{ 'is-on': selected.length > 0, 'is-off': disabled }"
      :aria-disabled="disabled"
      :aria-expanded="open"
      @click="disabled && $emit('blocked')"
    >
      <ToolOutlined class="text-[13px]" />
      工具
      <!-- 勾了几个直接写在圆片上 —— 不然得点开弹层才知道开了哪些 -->
      <span v-if="selected.length" class="text-[11px] opacity-90">({{ selected.length }})</span>
      <DownOutlined class="text-[10px]" />
    </button>
  </a-popover>
</template>

<script setup>
import { ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useToolStore } from '@/stores/tools.js'

/**
 * 工具勾选状态放在 store 里 —— 首页和聊天页共用同一份,
 * 而且刷新页面后还是勾着的(持久化,见 stores/tools.js)。
 */
const toolStore = useToolStore()
const { list, selected } = storeToRefs(toolStore)

/** 弹层是不是开着 */
const open = ref(false)

defineProps({
  /**
   * 置灰(这次这些工具不生效)
   *
   * <p>看图问答走的是多模态接口(/v9),后端不接工具 ——
   *    摆成能点的样子就是「点了没反应」的假开关。
   */
  disabled: {
    type: Boolean,
    default: false,
  },
})

defineEmits(['blocked'])
</script>

<style scoped>
/*
  弹层里的清单。
  ⚠️ 弹层是 Teleport 到 body 的,scoped 的属性选择器(data-v-xxx)够不到它 ——
     组件的 scope id 只落在组件自己的根元素上,而弹层渲染在组件**外面**。
     所以这里用 :global()。
*/
:global(.tool-panel) {
  min-width: 260px;
  max-width: 320px;
  padding: 4px 2px;
}

:global(.tool-panel-title) {
  font-size: 12px;
  color: #9ca3af;
  padding: 4px 8px 6px;
}

:global(.tool-panel .tool-row) {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 8px;
  cursor: pointer;
}

:global(.tool-panel .tool-row:hover) {
  background: #f5f7fa;
}

:global(.tool-panel .tool-row.is-off) {
  cursor: not-allowed;
  opacity: 0.55;
}

:global(.tool-panel .tool-row.is-off:hover) {
  background: transparent;
}

:global(.tool-panel .tool-name) {
  font-size: 13px;
  color: #262626;
  white-space: nowrap;
}

:global(.tool-panel .tool-desc) {
  font-size: 11px;
  color: #9ca3af;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
