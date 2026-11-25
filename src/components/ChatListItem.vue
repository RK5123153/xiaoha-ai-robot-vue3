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
      :class="active ? 'bg-gray-200 text-gray-900 font-medium' : 'text-gray-600 hover:bg-gray-100'"
      :title="chat.title"
      @click="$emit('select', chat.uuid)"
    >
      {{ chat.title }}
    </button>

    <!-- 改名 / 删除(悬停才出现) -->
    <div
      v-if="!editing"
      class="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5
             opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
    >
      <button type="button" class="side-btn" title="改名" @click.stop="startEdit">
        <SvgIcon name="edit" customCss="w-3.5 h-3.5" />
      </button>
      <button type="button" class="side-btn hover:text-red-500" title="删除" @click.stop="confirming = true">
        <SvgIcon name="trash" customCss="w-3.5 h-3.5" />
      </button>
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
import SvgIcon from '@/components/SvgIcon.vue'

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
const inputRef = ref(null)

/** 开始改名:把原标题搬进输入框,并自动全选(直接打字就能覆盖) */
const startEdit = () => {
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
  }
)
</script>

<style scoped>
.side-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  color: #9ca3af;
  transition: color 0.15s ease, background-color 0.15s ease;
}

.side-btn:hover {
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
