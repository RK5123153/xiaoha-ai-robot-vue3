<template>
  <!--
    data-uuid:侧边栏的滚动锚定靠它认出「用户正看着的那一条」——
    列表刷新时新会话插到最前面,靠这个标记把它挪回原位(见 Sidebar.vue 的 captureAnchor)。
  -->
  <div class="group relative" :data-uuid="chat.uuid">
    <!-- 改名中:就地变成输入框 -->
    <div v-if="editing" class="px-1 py-0.5">
      <input
        ref="inputRef"
        v-model="draft"
        maxlength="60"
        class="w-full bg-white border rounded-md px-2 py-1 text-sm text-gray-800 outline-none transition-colors"
        :class="invalid ? 'border-red-400' : 'border-[#4d6bfe]'"
        @input="invalid = false"
        @keydown.enter.prevent="commit('enter')"
        @keydown.esc.prevent="cancel"
        @blur="commit('blur')"
      />
    </div>

    <!--
      正常状态:标题
      ⚠️ 提示用 antd 的 <a-tooltip>,不用原生 title:
         原生 title 要悬停 1 秒才弹,样式还是浏览器自带的灰方块。
         标题被折断时用户看不到全文 —— tooltip 就是给这种情况准备的。
         ⚠️ 别再往这个按钮上补原生 title —— title 和 a-tooltip 会**弹两次**。
    -->
    <a-tooltip v-else placement="top" :title="tooltipTitle">
      <button
        ref="titleRef"
        type="button"
        class="w-full text-left px-3 py-2 pr-12 rounded-lg text-sm truncate transition-colors"
        :class="active ? 'bg-[#eef6ff] text-[#4d6bfe] font-medium' : 'text-gray-600 hover:bg-[#eef6ff] hover:text-gray-900'"
        @mouseenter="onTitleHover"
        @click="$emit('select', chat.uuid)"
      >
        {{ chat.title }}
      </button>
    </a-tooltip>

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
          :disabled="busy"
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

    <!--
      删除确认:盖在标题上,不弹原生 confirm(那个丑且阻塞)。

      ⚠️ 措辞是「永久删除」不是「确定删除」——
         后端 /chat/delete 是**硬删**(会话行 + 消息 + Cassandra 记忆窗口全清),
         不是软删。字面上说清楚,用户才不会以为删错了还能找回来。

      ⚠️ 请求在飞的时候(busy)这一块**别拆**:
         拆了的话用户会看到「行还在、确认框没了、什么也没发生」——
         以为没点上,于是又点一次删除。
    -->
    <div
      v-if="confirming"
      class="absolute inset-0 z-10 flex items-center gap-1.5 px-2.5 rounded-lg bg-red-50 border border-red-200 text-xs"
    >
      <span class="text-red-600">永久删除?</span>
      <button
        type="button"
        class="confirm-btn bg-red-500 text-white"
        :disabled="busy"
        @click.stop="doDelete"
      >
        {{ busy ? '删除中…' : '删除' }}
      </button>
      <button
        type="button"
        class="confirm-btn text-gray-500 hover:text-gray-800"
        :disabled="busy"
        @click.stop="cancelDelete"
      >
        取消
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref, nextTick, watch } from 'vue'
// 这里给 message 起别名:ChatListItem 里已经有叫 message 的语义(会话标题),别抢
import { message as antMessage } from 'ant-design-vue'

/**
 * 侧边栏里的一个会话
 *
 * <p>三件事:显示标题、改名、删除。
 * 具体的请求在 store 里(stores/sessions.js),这里只管交互和发事件。
 */
const props = defineProps({
  /** 会话:{ uuid, id, title } */
  chat: { type: Object, required: true },
  /** 是不是当前打开的那个会话 */
  active: { type: Boolean, default: false },
  /**
   * 有一个请求正在飞(改名/删除还没回来)
   *
   * <p>⚠️ 这不是「装饰」:连点两下「删除」会发两个请求,
   *    后一个必然失败(会话已经没了),用户看到的是「删除成功」紧跟着一条报错。
   *    请求在飞的时候把这一行锁住。
   */
  busy: { type: Boolean, default: false },
})

const emit = defineEmits(['select', 'rename', 'delete'])

/** 正在改名 */
const editing = ref(false)
/** 改名输入框里的草稿 */
const draft = ref('')
/** 上一次提交是空标题(输入框描红) */
const invalid = ref(false)
/** 正在确认删除 */
const confirming = ref(false)
/** 下拉菜单是不是开着(开着的时候「⋯」按钮要一直显示) */
const menuOpen = ref(false)
const inputRef = ref(null)

/** 标题那个元素(用来量它有没有被折断) */
const titleRef = ref(null)
/** tooltip 要显示的内容;空字符串 = 不显示 */
const tooltipTitle = ref('')

/**
 * 鼠标划过标题时:看看它是不是被折断了
 *
 * <p>只有真被截断才提示 —— 短标题也弹 tooltip 是噪音
 * (鼠标在一列会话上扫过去,弹十几次更烦)。
 *
 * <p>量法:scrollWidth 是内容的完整宽度(被折断时比可见宽度大),
 * clientWidth 是可见框的宽度。两者一比就知道有没有折断。
 */
const onTitleHover = () => {
  const el = titleRef.value
  tooltipTitle.value = el && el.scrollWidth > el.clientWidth ? props.chat.title : ''
}

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
  // 请求还在飞 → 菜单里的操作一律不接(免得删一半又改一半)
  if (props.busy) return
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
  if (props.busy) return
  confirming.value = true
}

/** 开始改名:把原标题搬进输入框,并自动全选(直接打字就能覆盖) */
const startEdit = () => {
  // 下拉马上要被拆掉,「开着」这个状态得先收(见 onMenuClick 的说明)
  menuOpen.value = false
  draft.value = props.chat.title
  invalid.value = false
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
  invalid.value = false
  menuOpen.value = false
}

/**
 * 提交改名
 *
 * @param {'enter'|'blur'} source 提交手势:
 *   · enter —— 回车,是「我就是要改成这样」;
 *   · blur  —— 点走了,是「算了」,当取消处理。
 *
 * ⚠️ 标题被后端截断到 60 个字,前端也限制一下长度,
 *    不然改了名会被后端悄悄截掉一半,用户以为改名没生效。
 *
 * ⚠️ 空标题后端会拒(@NotBlank → 400),前端先拦一道:
 *    白跑一趟不说,光标还会从输入框里跳走,用户根本不知道自己想改什么。
 */
const commit = (source = 'blur') => {
  if (!editing.value) return
  const summary = draft.value.trim()

  // 空标题:标红 + 提示
  if (!summary) {
    invalid.value = true
    antMessage.error('标题不能为空')
    if (source === 'enter') {
      // 回车提交 → 留在编辑状态,让用户接着改(别把输入框收了)
      nextTick(() => {
        inputRef.value?.focus()
        inputRef.value?.select()
      })
      return
    }
    // 点走了 → 当取消,恢复原标题
    editing.value = false
    draft.value = ''
    invalid.value = false
    return
  }

  editing.value = false
  draft.value = ''
  invalid.value = false
  menuOpen.value = false
  // 标题没变 → 不用发请求
  if (summary === props.chat.title) return
  // ⚠️ 发的是**对象**而不是一串参数:父组件要拿 uuid 才能把这一行锁住
  //    (uuid 只有行组件自己知道,父组件手上只有 id)
  emit('rename', { id: props.chat.id, uuid: props.chat.uuid, summary })
}

/**
 * 确认删除
 *
 * ⚠️ 这里**不**把 confirming 置回 false —— 请求还在飞,
 *    确认框要留着(按钮显示「删除中…」),不然用户会以为没点上,再点一次。
 *    成功 → 这一行会被父组件从列表里摘掉,组件直接卸载;
 *    失败 → 确认框还在,用户可以再试一次。
 */
const doDelete = () => {
  if (props.busy) return
  emit('delete', props.chat.uuid)
}

/** 取消删除 */
const cancelDelete = () => {
  if (props.busy) return
  confirming.value = false
}

// 删掉当前会话后,正在编辑的那个也跟着没了 —— 把编辑态收掉,免得输入框留在半空中
watch(
  () => props.chat.uuid,
  () => {
    editing.value = false
    confirming.value = false
    invalid.value = false
    menuOpen.value = false
    // 标题换了,上一次量出来的「要不要提示」也就过期了
    tooltipTitle.value = ''
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

/* 请求在飞:按钮别再响应 */
.more-btn:disabled {
  color: #d1d5db;
  background-color: transparent;
  cursor: not-allowed;
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

.confirm-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
