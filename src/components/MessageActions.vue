<template>
  <!--
    消息底部的操作栏（参考 Kimi 的设计）：
    朗读 / 复制 / 重新生成 / 点赞 / 点踩

    整条消息**流式输出完之后**才出现（父组件用 v-if 控制），
    正在打字的时候显示这排按钮没意义。
  -->
  <div class="msg-actions flex items-center gap-3.5 mt-2.5 select-none">
    <!-- 朗读 -->
    <button
      type="button"
      class="action-btn"
      :class="{ 'is-active': speaking }"
      :disabled="!canSpeak || !text"
      :title="speaking ? '停止朗读' : '朗读'"
      :aria-label="speaking ? '停止朗读' : '朗读'"
      @click="toggleSpeak"
    >
      <SvgIcon name="speaker" customCss="w-[17px] h-[17px]"></SvgIcon>
    </button>

    <!-- 复制 -->
    <button
      type="button"
      class="action-btn"
      :class="{ 'is-active': copied }"
      :title="copied ? '已复制' : '复制'"
      :aria-label="copied ? '已复制' : '复制'"
      @click="handleCopy"
    >
      <SvgIcon :name="copied ? 'check' : 'copy'" customCss="w-[17px] h-[17px]"></SvgIcon>
    </button>

    <!-- 重新生成：问候语没有对应的提问，直接不显示这个按钮 -->
    <button
      v-if="canRegenerate"
      type="button"
      class="action-btn"
      :disabled="regenerating"
      title="重新生成"
      aria-label="重新生成"
      @click="$emit('regenerate')"
    >
      <SvgIcon name="refresh" customCss="w-[17px] h-[17px]"></SvgIcon>
    </button>

    <!-- 点赞 -->
    <button
      type="button"
      class="action-btn"
      :class="{ 'is-active': feedback === 'up' }"
      :title="feedback === 'up' ? '取消点赞' : '点赞'"
      :aria-label="feedback === 'up' ? '取消点赞' : '点赞'"
      @click="emitFeedback('up')"
    >
      <SvgIcon :name="feedback === 'up' ? 'thumb-up-fill' : 'thumb-up'" customCss="w-[17px] h-[17px]"></SvgIcon>
    </button>

    <!-- 点踩 -->
    <button
      type="button"
      class="action-btn"
      :class="{ 'is-active': feedback === 'down' }"
      :title="feedback === 'down' ? '取消点踩' : '点踩'"
      :aria-label="feedback === 'down' ? '取消点踩' : '点踩'"
      @click="emitFeedback('down')"
    >
      <SvgIcon :name="feedback === 'down' ? 'thumb-down-fill' : 'thumb-down'" customCss="w-[17px] h-[17px]"></SvgIcon>
    </button>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import SvgIcon from '@/components/SvgIcon.vue'
import { copyText } from '@/utils/clipboard.js'
import { toPlainText } from '@/utils/plain-text.js'
import { speechSupported } from '@/utils/speech.js'
import { speakWithFallback, stopTts } from '@/utils/tts.js'

const props = defineProps({
  /** 这条消息的 Markdown 原文（复制和朗读都用它） */
  content: {
    type: String,
    default: '',
  },
  /** 当前反馈：'' | 'up' | 'down' */
  feedback: {
    type: String,
    default: '',
  },
  /** 正在重新生成（按钮置灰） */
  regenerating: {
    type: Boolean,
    default: false,
  },
  /** 能不能重新生成（问候语没有对应的提问，给 false 就不显示这个按钮） */
  canRegenerate: {
    type: Boolean,
    default: true,
  },
})

const emit = defineEmits(['regenerate', 'feedback'])

/**
 * 浏览器支不支持语音朗读
 *
 * 注意别写成 `const speechSupported = ref(speechSupported())` ——
 * const 有暂时性死区，初始化表达式里引用同名变量会直接抛
 * "Cannot access 'speechSupported' before initialization"。
 */
const canSpeak = ref(speechSupported())

/** 正在朗读 */
const speaking = ref(false)
/** 刚复制完（图标切成对勾，1.5 秒后恢复） */
const copied = ref(false)

/** 朗读用的纯文本（剥掉 Markdown 标记，免得把 ``` 和 ** 念出来） */
const text = computed(() => toPlainText(props.content))

let copiedTimer = null

/**
 * 朗读 / 停止朗读
 *
 * 走 `speakWithFallback`：后端 TTS（MiniMax，音质好）优先，
 * 后端没开或调不通时自动退回浏览器内置 TTS（speechSynthesis），用户无感。
 *
 * 再点一次是「停」：stopTts 会把后端音频和浏览器 TTS 一起掐掉，
 * 正在 await 的 promise 会返回，于是 speaking 自然复位。
 */
const toggleSpeak = async () => {
  if (speaking.value) {
    stopTts()
    speaking.value = false
    return
  }
  if (!text.value) return

  speaking.value = true
  try {
    await speakWithFallback(text.value, {
      onEnd: () => {
        speaking.value = false
      },
      onError: () => {
        speaking.value = false
      },
    })
  } catch (e) {
    speaking.value = false
  }
  // 兜底：无论走哪条路、以什么方式结束，按钮状态都要复位
  speaking.value = false
}

/**
 * 复制这条消息
 *
 * 复制的是 **Markdown 原文**（不是渲染后的纯文本）：
 * 粘到别的地方时标题、列表、代码块的结构都还在，
 * 粘到纯文本编辑器里也只是多了几个标记符号，能接受。
 */
const handleCopy = async () => {
  const ok = await copyText(props.content)
  if (!ok) return
  copied.value = true
  clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => {
    copied.value = false
  }, 1500)
}

/**
 * 点赞 / 点踩
 *
 * 再点一次同一个 = 取消。父组件负责存状态并上报后端。
 */
const emitFeedback = (rating) => {
  emit('feedback', props.feedback === rating ? '' : rating)
}

// 组件被销毁（切页面、消息被重渲染掉）时把朗读停掉，
// 不然会听到一条已经不存在的消息的声音
onBeforeUnmount(() => {
  if (speaking.value) stopTts()
  clearTimeout(copiedTimer)
})
</script>

<style scoped>
.msg-actions {
  /* 图标按钮本身没什么存在感，鼠标移上去才明显 */
  color: #9ca3af;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 3px;
  border-radius: 6px;
  color: inherit;
  background: transparent;
  border: none;
  cursor: pointer;
  transition: color 0.15s ease, background-color 0.15s ease;
}

.action-btn:hover:not(:disabled) {
  color: #4b5563;
  background: rgba(0, 0, 0, 0.04);
}

/* 生效状态（正在朗读 / 已复制 / 已点赞）：品牌色 + 淡底 */
.action-btn.is-active {
  color: #4d6bfe;
  background: rgba(77, 107, 254, 0.1);
}

.action-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
