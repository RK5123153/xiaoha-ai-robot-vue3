<template>
  <a-dropdown placement="bottomLeft" :trigger="['click']" @open-change="onOpenChange">
    <!--
      ⚠️ 触发器只能是**一个**元素(antd 的 Dropdown 会往它身上挂点击事件)。
      所以这里不要往里再套 Tooltip —— 套了的话点击事件会挂到 Tooltip 上,
      触发器就失灵了。说明文字用原生 title 兜着。
    -->
    <button
      type="button"
      class="chip"
      :title="currentDesc"
      aria-label="选择对话模型"
      :aria-expanded="open"
    >
      <span class="truncate max-w-[110px]">{{ currentLabel }}</span>
      <!--
        菜单展开时箭头转 180 度 —— 「这个圆片是可展开的」的暗示,
        展开后箭头朝上也确实表示「往上收起来」。
      -->
      <DownOutlined
        class="text-[10px] text-gray-400 shrink-0 transition-transform duration-200"
        :class="{ 'rotate-180': open }"
      />
    </button>

    <template #overlay>
      <a-menu class="model-menu" :selected-keys="[selectedKey]" @click="onSelect">
        <a-menu-item v-for="m in items" :key="m.key">
          <div class="model-item">
            <div class="min-w-0">
              <p class="model-name">{{ m.name }}</p>
              <p v-if="m.description" class="model-desc">{{ m.description }}</p>
            </div>
            <!-- 当前选中的那个打个勾 -->
            <CheckOutlined v-if="m.key === selectedKey" class="model-check" />
          </div>
        </a-menu-item>
      </a-menu>
    </template>
  </a-dropdown>
</template>

<script setup>
import { computed, ref } from 'vue'
import { modelState, selectModel } from '@/utils/chat-store.js'

/**
 * 「默认模型」这一项在 Menu 里用的 key
 *
 * <p>⚠️ 不能用空串:antd 的 Menu 靠 key 认选项,
 *    空串在 key→option 的映射里会被当成「没有 key」。
 */
const DEFAULT_KEY = '__default__'

/** 菜单是不是展开着 —— 用来转箭头 */
const open = ref(false)

/** antd 的 Dropdown 展开/收起时回调 */
const onOpenChange = (v) => {
  open.value = v
}

/**
 * 菜单里的选项:默认模型 + 后端给的那几个
 *
 * <p>描述文字是后端给的(比如「思考链完整,支持联网搜索」)——
 *    摆在这儿,用户选之前就知道这个模型会不会联网、答得深不深。
 */
const items = computed(() => [
  {
    key: DEFAULT_KEY,
    name: '默认模型(后端配置)',
    description: '由后端配置决定用哪个模型',
  },
  ...modelState.models.map((m) => ({
    key: m.code,
    name: m.name,
    description: m.description || '',
  })),
])

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

<style scoped>
/*
  菜单项要放两行(模型名 + 一句说明)—— antd 默认是固定 32px 一行,
  不放开高度的话第二行会被裁掉。

  ⚠️ 用 :global():菜单是 Teleport 到 body 的,
     scoped 的属性选择器(data-v-xxx)够不到它 —— 组件的 scope id 只落在
     组件自己的根元素上,而菜单是渲染在组件**外面**的。
*/
:global(.model-menu) {
  min-width: 240px;
}

:global(.model-menu .ant-dropdown-menu-item) {
  height: auto;
  padding: 6px 12px;
  line-height: 1.45;
}

.model-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.model-name {
  font-size: 13px;
  line-height: 18px;
  color: #262626;
}

.model-desc {
  font-size: 11px;
  line-height: 16px;
  color: #9ca3af;
  margin-top: 1px;
}

/* 对号:跟着文字的颜色走(选中时是主色,没选中是灰的) */
.model-check {
  flex-shrink: 0;
  font-size: 13px;
  color: #4d6bfe;
}
</style>
