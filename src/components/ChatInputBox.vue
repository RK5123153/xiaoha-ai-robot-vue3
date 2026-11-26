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

    <p>⚠️ **一个输入框,不分「文字对话 / 看图说话」**:
       带没带图是页面那边根据附件判断的(见 ChatPage.vue 的 sendMessage),
       这里只管把附件显示出来。
  -->
  <div
    class="input-box"
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

    <!-- 模式提示(比如「看图问答不带聊天记忆」) -->
    <p v-if="hint" class="hint">{{ hint }}</p>

    <textarea
      v-model="innerValue"
      :placeholder="placeholder"
      class="input-textarea"
      rows="2"
      @input="autoResize"
      @keydown="handleKeydown"
      @compositionstart="handleCompositionStart"
      @compositionend="handleCompositionEnd"
      ref="textareaRef"
    ></textarea>

    <!--
      底部一行(参考 DeepSeek 的布局):
      左边是「能力开关」(工具 / 模型 / 联网搜索),右边是「图片 / 发送」。

      ⚠️ flex-wrap + ml-auto:
         窄屏上左边的圆片换行时,右边的发送按钮要跟着换行还保持靠右 ——
         用 ml-auto 而不是「中间塞一个 grow 的空 div」才能做到:
         空 div 在换行后会占掉一整行,把按钮挤到下一行去。
    -->
    <div class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <!--
        ⚠️ 带图时(看图问答)这三个开关**这次不生效** ——
        多模态那条路(/v9)后端不接模型、也不接联网搜索和工具。
        摆成正常的样子就是「点了没反应」的假开关,所以直接置灰,
        鼠标悬停说明为什么。
      -->
      <a-tooltip
        :title="vision ? '看图问答走的是多模态接口,模型 / 联网搜索 / 工具这次都不生效' : ''"
        placement="top"
      >
        <div class="flex items-center gap-2 flex-wrap min-w-0">
          <ToolPicker :disabled="vision" />
          <ModelPicker :disabled="vision" />
          <WebSearchToggle :disabled="vision" />
        </div>
      </a-tooltip>

      <div class="flex items-center gap-2 ml-auto">
        <ImagePicker :disabled="busy" @pick="onPickImage" />
        <!--
          ⚠️ 发送按钮用 aria-disabled 而不是 disabled:
          disabled 的按钮在浏览器里**不派发鼠标事件**,antd 的 Tooltip 靠的就是这些事件
          → 灰着的按钮反而**弹不出**「为什么还不能发」的说明,而这恰恰是最需要说明的时候。

          ⚠️ 别再给这个按钮加原生 title —— title 和 a-tooltip 会**弹两次**。

          ⚠️ streaming(正在流式输出)时这个按钮**变成「停止」**:
             模型卡住、答得太慢、或者用户突然不想听了,总得给个能按的东西 ——
             一个灰着的死按钮等于没给。
             (AbortController 一直都在,见 ChatPage.vue 的 stopStream,
              只是以前没有任何入口能碰到它。)
        -->
        <a-tooltip :title="streaming ? '停止生成' : sendTooltip" placement="top">
          <button
            type="button"
            @click="streaming ? onStop() : onSend()"
            :aria-disabled="!streaming && sendDisabled"
            :aria-label="streaming ? '停止生成' : '发送消息'"
            class="send-btn"
          >
            <!-- 停止:一个实心小方块 -->
            <span v-if="streaming" class="block w-2.5 h-2.5 rounded-[2px] bg-white"></span>
            <ArrowUpOutlined v-else class="text-xl" />
          </button>
        </a-tooltip>
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
import ToolPicker from '@/components/ToolPicker.vue'
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
  /**
   * 发送按钮置灰的原因(鼠标悬停时显示)
   *
   * <p>比如没有图片时是「先选一张图」——
   *    光看一个灰按钮,用户不知道还差什么。
   */
  sendHint: {
    type: String,
    default: '',
  },
  /** 占位提示 */
  placeholder: {
    type: String,
    default: '给小哈 AI 机器人发送消息（Enter 发送，Shift + Enter 换行）',
  },
  /**
   * 输入框上方的一行小字提示
   *
   * <p>比如「看图问答不带聊天记忆」——
   *    有些限制光靠置灰说不清楚,得有一行字讲明白。
   */
  hint: {
    type: String,
    default: '',
  },
  /**
   * 正在走「看图问答」那条链路(带了图)
   *
   * <p>那条路(/v9/ai)后端不接模型、也不接联网搜索和工具 ——
   *    所以那几个开关要置灰,不能让用户以为这次生效了。
   */
  vision: {
    type: Boolean,
    default: false,
  },
  /** 正在流式输出(发送按钮变成「停止」) */
  streaming: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['update:modelValue', 'send', 'stop', 'pick-image', 'remove-image'])

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
 *   另外部分浏览器在 compositionend 之后还会补发一个 keydown,
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
 * 发送
 * ────────────────────────────────────────────────────────────────────── */

/**
 * 发送按钮悬停时显示什么
 *
 * <p>发不了的时候显示「为什么发不了」(比如「先选一张图」),
 *    能发的时候显示「发送（Enter）」。
 */
const sendTooltip = computed(() =>
  props.sendDisabled ? props.sendHint || '现在还不能发送' : '发送（Enter）'
)

/**
 * 点发送
 *
 * <p>⚠️ 按钮用的是 aria-disabled 而不是 disabled(为了让 Tooltip 能弹出来),
 *    所以「置灰」只是样子 —— 点击事件照样会来,得在这儿真拦一道。
 */
const onSend = () => {
  if (props.sendDisabled) return
  emit('send')
}

/**
 * 点「停止生成」
 *
 * <p>只是把「我要停了」这件事告诉页面 —— 真正掐断请求的是页面那边
 *    (AbortController 在那儿,组件里没有)。
 */
const onStop = () => {
  emit('stop')
}

/* ──────────────────────────────────────────────────────────────────────
 * 图片:拖进来 / 粘贴进来
 * ────────────────────────────────────────────────────────────────────── */

/** 拖拽进入计数器:dragenter/dragleave 会在子元素间反复触发,用计数才不会闪 */
let dragDepth = 0

const onDragEnter = () => {
  dragDepth++
  isDragOver.value = true
}

const onDragLeave = () => {
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
/*
  输入框本体:白底 + 描边 + 大圆角(参考 DeepSeek 的样子)。

  ⚠️ 原来是灰底(rounded-3xl 的灰盒子),现在改成白底描边 ——
     页面本身是白底,输入框得靠描边才「浮」出来。
*/
.input-box {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 16px;
  padding: 10px 14px 12px;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

/* 聚焦时描边深一点、给一点点阴影 —— 让用户知道「现在能打字了」 */
.input-box:focus-within {
  border-color: #d1d5db;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.04);
}

/* 拖拽悬停:告诉用户「可以放这儿」 */
.input-box.is-dropping {
  background: #eff6ff;
  border-color: #4d6bfe;
}

/* 输入框上方的一行小字提示(比如「看图问答不带聊天记忆」) */
.hint {
  margin-bottom: 6px;
  font-size: 11px;
  line-height: 16px;
  color: #9ca3af;
}

/* 文本域:透明底、无边框,高度由脚本管 */
.input-textarea {
  background: transparent;
  border: none;
  outline: none;
  width: 100%;
  font-size: 14px;
  line-height: 22px;
  resize: none;
  min-height: 24px;
  color: #262626;
}

/* 发送按钮:品牌蓝圆钮 */
.send-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 9999px;
  background: #4d6bfe;
  color: #fff;
  border: 1px solid #4d6bfe;
  cursor: pointer;
  transition: background-color 0.15s ease, opacity 0.15s ease;
}

.send-btn:hover {
  background: #3b5bef;
}

.send-btn[aria-disabled='true'] {
  opacity: 0.5;
  cursor: not-allowed;
}

.send-btn[aria-disabled='true']:hover {
  background: #4d6bfe;
}
</style>
