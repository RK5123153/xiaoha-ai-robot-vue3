<template>
  <!--
    聊天输入框 —— 首页和聊天页共用**同一个**组件

    ⚠️ 为什么抽出来:
       两个页面的输入框长得一模一样、用起来也一模一样(自动长高、Enter 发送、
       拖图/粘贴图、压缩、预览)。以前是各写一份,于是:
         · 首页改了 Enter 的行为、聊天页没改 → 两边手感不一样
         · 图片压缩策略改了一处、另一处忘了 → 「首页能发图,聊天页发不出去」
       现在只有这一份实现,两个页面只是传不同的 props。

    <p>它不管「发出去之后怎么办」—— 那是页面的事:
       它只负责把「用户按了发送」「用户选了一张图」这两件事通知给页面。
  -->
  <div
    class="bg-gray-100 rounded-3xl px-4 py-3 flex flex-col border border-gray-200 transition-colors"
    :class="{ 'is-dropping': isDragOver }"
    @dragenter.prevent="onDragEnter"
    @dragover.prevent
    @dragleave.prevent="onDragLeave"
    @drop.prevent="onDrop"
    @paste="onPaste"
  >
    <!-- 已选中的图片(还没发出去) -->
    <div v-if="attachment" class="mb-2">
      <ImageChip
        :attachment="attachment"
        :busy="busy"
        @remove="$emit('remove-image')"
        @preview="previewUrl = attachment.previewUrl"
      />
    </div>

    <!-- 工具开关:勾上的工具才会发给模型。首页和聊天页共用同一份勾选(存在 store 里) -->
    <ToolBar v-if="showTools" />

    <!-- 模式提示(比如「看图说话不带聊天记忆」) -->
    <p v-if="hint" class="hint">{{ hint }}</p>

    <textarea
      v-model="innerValue"
      :placeholder="placeholder"
      class="bg-transparent border-none outline-none w-full text-sm resize-none min-h-[24px]"
      rows="2"
      @input="autoResize"
      @keydown="handleKeydown"
      @compositionstart="handleCompositionStart"
      @compositionend="handleCompositionEnd"
      ref="textareaRef"
    ></textarea>

    <!--
      底部一排:左边是「模型选择 / 联网搜索」,右边是「图片 / 发送」。

      ⚠️ flex-wrap + ml-auto:
         窄屏上左边的圆片换行时,右边的发送按钮要跟着换行还保持靠右 ——
         用 ml-auto 而不是「中间塞一个 grow 的空 div」才能做到:
         空 div 在换行后会占掉一整行,把按钮挤到下一行去。
    -->
    <div class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <div class="flex items-center gap-2 flex-wrap min-w-0">
        <ModelPicker />
        <WebSearchToggle />
      </div>

      <div class="flex items-center gap-2 ml-auto">
        <ImagePicker v-if="allowImage" :disabled="busy" @pick="onPickImage" />
        <button
          type="button"
          @click="$emit('send')"
          :disabled="sendDisabled"
          aria-label="发送消息"
          title="发送（Enter）"
          class="flex items-center justify-center bg-[#4d6bfe] text-white rounded-full w-8 h-8
                 border border-[#4d6bfe] hover:bg-[#3b5bef] transition-colors
                 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-[#4d6bfe]"
        >
          <ArrowUpOutlined class="text-xl" />
        </button>
      </div>
    </div>

    <!-- 图片放大预览 -->
    <ImagePreview v-if="previewUrl" :url="previewUrl" @close="previewUrl = ''" />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, nextTick } from 'vue'
import { message as antMessage } from 'ant-design-vue'
import ImageChip from '@/components/ImageChip.vue'
import ImagePicker from '@/components/ImagePicker.vue'
import ImagePreview from '@/components/ImagePreview.vue'
import ModelPicker from '@/components/ModelPicker.vue'
import WebSearchToggle from '@/components/WebSearchToggle.vue'
import ToolBar from '@/components/ToolBar.vue'
import { isImageFile } from '@/utils/image.js'

const props = defineProps({
  /** 输入框里的文字(v-model) */
  modelValue: {
    type: String,
    default: '',
  },
  /** 待发送的图片:{ id, file, previewUrl, name, size } */
  attachment: {
    type: Object,
    default: null,
  },
  /** 正在压缩图片(大图要缩放,有几百毫秒的空档) */
  busy: {
    type: Boolean,
    default: false,
  },
  /** 发送按钮置灰 */
  sendDisabled: {
    type: Boolean,
    default: false,
  },
  /** 占位提示 */
  placeholder: {
    type: String,
    default: '给小哈 AI 机器人发送消息（Enter 发送，Shift + Enter 换行）',
  },
  /** 能不能带图:图片按钮 + 拖拽 + 粘贴,三个一起开关 */
  allowImage: {
    type: Boolean,
    default: false,
  },
  /** 要不要显示工具开关 */
  showTools: {
    type: Boolean,
    default: true,
  },
  /** 输入框上方的一行小字提示 */
  hint: {
    type: String,
    default: '',
  },
})

const emit = defineEmits(['update:modelValue', 'send', 'pick-image', 'remove-image'])

/** 拖拽悬停在输入框上(高亮提示「可以放这儿」) */
const isDragOver = ref(false)

/** 放大的图片预览 */
const previewUrl = ref('')

const textareaRef = ref(null)

/** 输入框里的文字(v-model 走它,好让外面用 v-model 用) */
const innerValue = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

/** 输入框最大高度(px)。超过就在输入框内部滚动,不把整个页面挤爆 */
const MAX_INPUT_HEIGHT = 300

/**
 * 自动调整文本域高度
 *
 * 关键点:
 * 1. 先把 height 归零再量 scrollHeight —— 否则删字时高度只增不减,框会越撑越大
 * 2. 量到的高度要封顶,超过 MAX_INPUT_HEIGHT 就让输入框自己滚
 */
const autoResize = () => {
  const textarea = textareaRef.value
  if (!textarea) return
  textarea.style.height = 'auto'
  const contentHeight = textarea.scrollHeight
  textarea.style.height = Math.min(contentHeight, MAX_INPUT_HEIGHT) + 'px'
  textarea.style.overflowY = contentHeight > MAX_INPUT_HEIGHT ? 'auto' : 'hidden'
}

/**
 * 内容变了就把高度收回去
 *
 * <p>发完消息页面会把输入框清空 —— 不跟着收的话,
 *    输入框会一直保持着发消息前那几行字的高度。
 */
watch(
  () => props.modelValue,
  async () => {
    await nextTick()
    autoResize()
  }
)

/* ──────────────────────────────────────────────────────────────────────
 * 键盘:Enter 发送,Shift + Enter 换行
 * ────────────────────────────────────────────────────────────────────── */

/** 输入法组字状态:中文输入法选词时会触发 Enter,必须和「发送」区分开 */
const isComposing = ref(false)
/** 最近一次输入法结束的时间戳:部分浏览器在 compositionend 之后还会补发一个 Enter */
let composingEndedAt = 0

const handleCompositionStart = () => {
  isComposing.value = true
}

const handleCompositionEnd = () => {
  isComposing.value = false
  composingEndedAt = Date.now()
}

/**
 * ⚠️ 中文输入法(最容易被忽略的坑):
 *   用拼音打字时按 Enter 是「选词」,不是「发送」。不加判断的话,
 *   用户每选一次词就会把半句话发出去。
 *   三个信号一起看才稳:
 *     1. e.isComposing  —— 标准属性,组字期间为 true
 *     2. e.keyCode === 229 —— 老浏览器的组字标记
 *     3. isComposing.value —— 我们自己在 compositionstart/end 里维护的状态
 *   另外部分浏览器在 compositionend 之后还会补发一个 Enter 的 keydown,
 *   用时间戳把这一小段时间内的 Enter 吞掉(人手动再按一次至少隔 150ms,误伤不到)。
 */
const handleKeydown = (e) => {
  if (e.key !== 'Enter') return
  if (e.isComposing || e.keyCode === 229 || isComposing.value) return
  if (Date.now() - composingEndedAt < 100) return
  if (e.shiftKey) return
  e.preventDefault()
  emit('send')
}

/* ──────────────────────────────────────────────────────────────────────
 * 图片:拖进来 / 粘贴进来
 * ────────────────────────────────────────────────────────────────────── */

/** 拖拽进入计数器:dragenter/dragleave 会在子元素间反复触发,用计数才不会闪 */
let dragDepth = 0

const onDragEnter = () => {
  if (!props.allowImage) return
  dragDepth++
  isDragOver.value = true
}

const onDragLeave = () => {
  if (!props.allowImage) return
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) isDragOver.value = false
}

/**
 * 放下文件(只认图片)
 *
 * <p>⚠️ 只认图片:拖进来一个 txt 的话,后端会 400,
 *    而且 Spring AI 会**静默丢掉**非图片附件(症状是「图没发出去,模型只看到一句话」),
 *    所以前端先拦一道,给人话。
 */
const onDrop = (e) => {
  dragDepth = 0
  isDragOver.value = false
  if (!props.allowImage) return
  const files = e.dataTransfer?.files || []
  for (const f of files) {
    if (isImageFile(f)) {
      emit('pick-image', f)
      return
    }
  }
  antMessage.info('只能把图片拖进来')
}

/**
 * 粘贴图片(截图工具 / 右键复制图片)
 *
 * <p>⚠️ 不 preventDefault:剪贴板里可能同时有图和字(比如从网页复制一段),
 *    把文字也挡掉的话用户会觉得「粘贴失灵了」。
 */
const onPaste = (e) => {
  if (!props.allowImage) return
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (item.kind === 'file' && item.type?.startsWith('image/')) {
      const file = item.getAsFile()
      if (file) {
        emit('pick-image', file)
        return
      }
    }
  }
}

/** 点了「图片」按钮 */
const onPickImage = (file) => emit('pick-image', file)

/** 把焦点放到输入框里(页面发完消息后调用) */
const focus = () => textareaRef.value?.focus()

defineExpose({ focus })

onMounted(() => {
  autoResize()
  focus()
})
</script>

<style scoped>
/* 拖拽悬停:告诉用户「可以放这儿」 */
.is-dropping {
  background: #eff6ff;
  border-color: #4d6bfe;
}

/* 输入框上方的一行小字提示 */
.hint {
  margin-bottom: 6px;
  font-size: 11px;
  line-height: 16px;
  color: #9ca3af;
}
</style>
