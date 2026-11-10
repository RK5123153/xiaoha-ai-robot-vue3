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
      :class="{ 'is-active': speaking, 'is-loading': loading }"
      :disabled="!canSpeak || !text"
      :title="speechLabel"
      :aria-label="speechLabel"
      @click="toggleSpeak"
    >
      <!--
        三种图标：
          正在播 → 跳动的音波（蓝）
          正在准备 → 带缺口的圆弧在转（灰）
          平时 → 喇叭（灰）
        ⚠️ 音波和圆弧是**内联 SVG**，不是雪碧图里的图标 ——
           雪碧图用 <use> 渲染，里面的元素没法用 CSS 动（动不了）。
      -->
      <svg
        v-if="speaking"
        class="wave h-[17px] w-[17px]"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <rect class="wave-bar" x="2.2" y="8.5" width="2.6" height="7" rx="1.3" />
        <rect class="wave-bar" x="6.5" y="6" width="2.6" height="12" rx="1.3" />
        <rect class="wave-bar" x="10.8" y="3.5" width="2.6" height="17" rx="1.3" />
        <rect class="wave-bar" x="15.1" y="6" width="2.6" height="12" rx="1.3" />
        <rect class="wave-bar" x="19.4" y="8.5" width="2.6" height="7" rx="1.3" />
      </svg>
      <svg
        v-else-if="loading"
        class="spin h-[17px] w-[17px]"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle
          cx="12"
          cy="12"
          r="9"
          stroke="currentColor"
          stroke-width="2.6"
          stroke-linecap="round"
          stroke-dasharray="40 16.5"
        />
      </svg>
      <SvgIcon v-else name="speaker" customCss="w-[17px] h-[17px]"></SvgIcon>
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
/**
 * 正在准备（等后端合成音频 / 等浏览器语音列表）
 *
 * 后端合成要一两秒，这个空档必须有个反馈 —— 不然点了没反应，
 * 用户会以为按钮坏了，连点好几下。
 */
const loading = ref(false)
/** 刚复制完（图标切成对勾，1.5 秒后恢复） */
const copied = ref(false)

/** 朗读按钮的文案（状态不同文案不同） */
const speechLabel = computed(() =>
  loading.value ? '准备中' : speaking.value ? '停止朗读' : '朗读'
)

/** 朗读用的纯文本（剥掉 Markdown 标记，免得把 ``` 和 ** 念出来） */
const text = computed(() => toPlainText(props.content))

let copiedTimer = null

/**
 * 朗读 / 停止朗读
 *
 * 走 `speakWithFallback`：后端 TTS（MiniMax，音质好）优先，
 * 后端没开或调不通时自动退回浏览器内置 TTS（speechSynthesis），用户无感。
 *
 * 三个状态：
 *   loading  —— 点了之后、等音频这段时间（喇叭转圈）
 *   speaking —— 正在出声（喇叭高亮，再点是「停」）
 *   都不是   —— 平时（喇叭灰的）
 *
 * 再点一次是「停」：stopTts 会把后端音频和浏览器 TTS 一起掐掉，
 * 正在 await 的 promise 会返回，于是状态自然复位。
 */
const toggleSpeak = async () => {
  if (loading.value || speaking.value) {
    stopTts()
    loading.value = false
    speaking.value = false
    return
  }
  if (!text.value) return

  loading.value = true
  try {
    await speakWithFallback(text.value, {
      // 真的出声了 → 转圈换成正在播
      onPlaying: () => {
        loading.value = false
        speaking.value = true
      },
      onEnd: () => {
        loading.value = false
        speaking.value = false
      },
      onError: () => {
        loading.value = false
        speaking.value = false
      },
    })
  } catch (e) {
    loading.value = false
    speaking.value = false
  }
  // 兜底：无论走哪条路、以什么方式结束，按钮状态都要复位
  loading.value = false
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
  if (speaking.value || loading.value) stopTts()
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

/* 加载中（等后端合成音频）：灰弧 + 淡灰底，跟「正在朗读」的蓝音波区分开 */
.action-btn.is-loading {
  background: rgba(0, 0, 0, 0.04);
}

/* 正在播：跳动的音波条 */
.wave-bar {
  fill: currentColor;
  /* scaleY 要绕**每根条自己**的中心缩放，
     不加这两行的话会绕整个 viewBox 的中心缩 —— 看着像整体拉伸 */
  transform-box: fill-box;
  transform-origin: center;
  animation: wave-bounce 0.9s ease-in-out infinite;
}
/* 每根条错开一点 —— 齐步走的话像呼吸，均衡错开才是波浪 */
.wave-bar:nth-child(1) { animation-delay: 0s; }
.wave-bar:nth-child(2) { animation-delay: -0.18s; }
.wave-bar:nth-child(3) { animation-delay: -0.36s; }
.wave-bar:nth-child(4) { animation-delay: -0.54s; }
.wave-bar:nth-child(5) { animation-delay: -0.72s; }

@keyframes wave-bounce {
  0%,
  100% {
    transform: scaleY(0.32);
  }
  50% {
    transform: scaleY(1);
  }
}

/* 正在准备：带缺口的圆弧在转 */
.spin {
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.action-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
