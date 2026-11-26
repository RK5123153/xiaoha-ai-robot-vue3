<template>
  <!--
    「大模型下拉框」—— 输入框左下角那个小圆片

    ⚠️ 为什么用 antd 的 Dropdown 而不是原生 <select>:
       原生 select 在 Windows 上是系统控件的样子,和站点其它控件不是一个产品;
       而且它没法显示模型的说明文字。
       Dropdown + Menu 还能顺带白拿键盘导航和「当前选中项高亮」。
  -->
  <a-dropdown placement="bottomLeft" :trigger="['click']">
    <!--
      ⚠️ 触发器只能是**一个**元素(antd 的 Dropdown 会往它身上挂点击事件)。
      所以这里不要往里再套 Tooltip —— 套了的话点击事件会挂到 Tooltip 上,
      触发器就失灵了。说明文字用原生 title 兜着。
    -->
    <button type="button" class="chip" :title="currentDesc" aria-label="选择对话模型">
      <span class="truncate max-w-[110px]">{{ currentLabel }}</span>
      <DownOutlined class="text-[10px] text-gray-400 shrink-0" />
    </button>

    <template #overlay>
      <a-menu :selected-keys="[selectedKey]" @click="onSelect">
        <a-menu-item key="__default__">默认模型(后端配置)</a-menu-item>
        <a-menu-item v-for="m in modelState.models" :key="m.code">
          {{ m.name }}
        </a-menu-item>
      </a-menu>
    </template>
  </a-dropdown>
</template>

<script setup>
import { computed } from 'vue'
import { modelState, selectModel } from '@/utils/chat-store.js'

/** 「默认模型」这一项在 Menu 里用的 key —— 不能用空串(Menu 靠 key 认选项) */
const DEFAULT_KEY = '__default__'

/** 当前选中的那一项的 key */
const selectedKey = computed(() => modelState.code || DEFAULT_KEY)

/** 按钮上显示的名字 */
const currentLabel = computed(() => {
  const model = modelState.models.find((m) => m.code === modelState.code)
  return model?.name || '默认模型'
})

/** 当前模型的说明(鼠标悬停时显示) */
const currentDesc = computed(() => {
  const model = modelState.models.find((m) => m.code === modelState.code)
  return model?.description || '用后端配置的默认模型'
})

/**
 * 选了某个模型
 *
 * <p>走 store 的 selectModel —— 它会顺手把「支不支持联网搜索」对齐到模型的能力,
 *    直接改 modelState.code 的话,换了不支持联网的模型,联网搜索还开着。
 */
const onSelect = ({ key }) => {
  selectModel(key === DEFAULT_KEY ? '' : key)
}
</script>
