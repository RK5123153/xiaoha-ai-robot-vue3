<template>
  <div class="group relative">
    <!-- 改名中:就地变成输入框 -->
    <div v-if="editing" class="px-1 py-0.5">
      <input
        ref="inputRef"
        v-model="draft"
        maxlength="60"
        class="w-full bg-white border border-[#4d6bfe] rounded-md px-2 py-1 text-sm text-gray-800 outline-none"
        @keydown.enter.prevent="commit"
        @keydown.esc.prevent="cancel"
        @blur="commit"
      />
    </div>

    <!-- 正常状态:标题 -->
    <button
      v-else
      type="button"
      class="w-full text-left px-3 py-2 pr-12 rounded-lg text-sm truncate transition-colors"
      :class="active ? 'bg-[#eef6ff] text-[#4d6bfe] font-medium' : 'text-gray-600 hover:bg-[#eef6ff] hover:text-gray-900'"
      :title="chat.title"
      @click="$emit('select', chat.uuid)"
    >
      {{ chat.title }}
    </button>

    <!--
      更多操作:一个「⋯」按钮 + 下拉菜单(重命名 / 删除)
      ⚠️ 原来摆的是两个图标按钮(铅笔 / 垃圾桶):
      一是挤(标题右边只剩 48px),二是以后再加「导出 / 复制」就没地方放。
      收成一个「⋯」之后,加操作项只要往菜单里加一行,不用改标题的 padding。
    -->
    <div v-if="!editing" class="absolute right-1.5 top-1/2 -translate-y-1/2 z-10">
      <a-dropdown v-model:open="menuOpen" trigger="click" placement="bottomRight">
        <template #overlay>
          <a-menu @click="onMenuClick">
            <!--
              ⚠️ 图标外面要套一层 inline-flex:
              Tailwind v4 的 preflight 把 svg 设成了 display:block,
              不套的话图标和文字会**上下两行**(不是左右并排)。
            -->
            <a-menu-item key="rename">
              <span class="inline-flex items-center"><EditOutlined class="text-base" /></span>
              重命名
            </a-menu-item>
            <a-menu-item key="delete" danger>
              <span class="inline-flex items-center"><DeleteOutlined class="text-base" /></span>
              删除
            </a-menu-item>
          </a-menu>
        </template>
        <button
          type="button"
          class="more-btn"
          :class="
            menuOpen
              ? 'opacity-100'
              : 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-visible:opacity-100 focus-visible:pointer-events-auto'
          "
          aria-label="更多操作"
          aria-haspopup="menu"
        >
          <EllipsisOutlined class="text-base" />
        </button>
      </a-dropdown>
    </div>

    <!-- 删除确认:盖在标题上,不弹原生 confirm(那个丑且阻塞) -->
    <div
      v-if="confirming"
      class="absolute inset-0 z-10 flex items-center gap-1.5 px-2.5 rounded-lg bg-red-50 border border-red-200 text-xs"
    >
      <span class="text-red-600">确定删除?</span>
      <button type="button" class="confirm-btn bg-red-500 text-white" @click.stop="doDelete">删除</button>
      <button type="button" class="confirm-btn text-gray-500 hover:text-gray-800" @click.stop="confirming = false">
        取消
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, nextTick, watch } from 'vue'

/**
 * 侧边栏里的一个会话
 *
 * <p>三件事:显示标题、改名、删除。
 * 具体的请求在 store 里(utils/chat-store.js),这里只管交互和发事件。
 */
const props = defineProps({
  /** 会话:{ uuid, id, title } */
  chat: { type: Object, required: true },
  /** 是不是当前打开的那个会话 */
  active: { type: Boolean, default: false },
})

const emit = defineEmits(['select', 'rename', 'delete'])

/** 正在改名 */
const editing = ref(false)
/** 改名输入框里的草稿 */
const draft = ref('')
/** 正在确认删除 */
const confirming = ref(false)
/** 下拉菜单是不是开着(开着的时候「⋯」按钮要一直显示) */
const menuOpen = ref(false)
const inputRef = ref(null)

/**
 * 点菜单项:按 key 分发
 *
 * <p>用菜单的 key 而不是给每个菜单项单独绑事件 ——
 *    antd 的 MenuItem 点击会冒泡到 Menu,key 是唯一标识。
 */
const onMenuClick = ({ key }) => {
  // ⚠️ 先把「菜单开着」这个状态收掉,再干活。
  //    点「重命名」会让整块下拉(含按钮)被 v-if 拆掉,
  //    antd 那边的「关闭」事件就传不回来了 → menuOpen 停在 true,
  //    这一行回到正常态时菜单会**自己弹开**(实测踩过)。
  menuOpen.value = false
  if (key === 'rename') startEdit()
  else if (key === 'delete') askDelete()
}

/**
 * 点了菜单里的「删除」
 *
 * <p>不直接删,先在行内弹确认框 —— 删会话不可撤销,
 *    一步到位的手滑就真没了(仓库里有过一次误删的记录)。
 */
const askDelete = () => {
  confirming.value = true
}

/** 开始改名:把原标题搬进输入框,并自动全选(直接打字就能覆盖) */
const startEdit = () => {
  // 下拉马上要被拆掉,「开着」这个状态得先收(见 onMenuClick 的说明)
  menuOpen.value = false
  draft.value = props.chat.title
  editing.value = true
  nextTick(() => {
    inputRef.value?.focus()
    inputRef.value?.select()
  })
}

/** 取消改名 */
const cancel = () => {
  editing.value = false
  draft.value = ''
  menuOpen.value = false
}

/**
 * 提交改名
 *
 * ⚠️ 标题被后端截断到 60 个字,前端也限制一下长度,
 *    不然改了名会被后端悄悄截掉一半,用户以为改名没生效。
 */
const commit = () => {
  if (!editing.value) return
  const summary = draft.value.trim()
  editing.value = false
  draft.value = ''
  menuOpen.value = false
  // 标题没变(或者被清空)→ 不用发请求
  if (!summary || summary === props.chat.title) return
  emit('rename', props.chat.id, summary)
}

/** 确认删除 */
const doDelete = () => {
  confirming.value = false
  emit('delete', props.chat.uuid)
}

// 删掉当前会话后,正在编辑的那个也跟着没了 —— 把编辑态收掉,免得输入框留在半空中
watch(
  () => props.chat.uuid,
  () => {
    editing.value = false
    confirming.value = false
    menuOpen.value = false
  }
)
</script>

<style scoped>
/* 「⋯」按钮:默认透明,悬停才有个浅底 */
.more-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  color: #9ca3af;
  transition: color 0.15s ease, background-color 0.15s ease, opacity 0.15s ease;
}

.more-btn:hover {
  color: #4d6bfe;
  background-color: rgba(0, 0, 0, 0.06);
}

.confirm-btn {
  padding: 1px 6px;
  border-radius: 4px;
  line-height: 16px;
  transition: opacity 0.15s ease;
}

.confirm-btn:hover {
  opacity: 0.85;
}
</style>
