<template>
  <!--
    深度思考面板 —— 把后端流过来的思考链摆出来。

    ⚠️ 为什么要单独一块:
       思考链是模型的内部推理(还可能是英文的),混进正文会污染最终回答,
       所以它单独一块、灰字、小字,正文那块保持干净(见 ChatPage.vue)。

    ⚠️ 为什么不只是「等模型开口时的等待提示」:
       思考链是**这一轮的一部分** —— 答完了它也还在,用户可能要回看。
       而且后端把它归档在 t_chat_message.reasoning 里,拉历史时一起带回来,
       刷新页面还能翻出来(见 ChatPage.vue 的 mapHistory)。
       所以它得是常驻的一块,不是一个用完即弃的动画。

    ⚠️ 正文**开始输出**之后它会自动收起:
       思考链可能很长(一两屏),摊在正文上面会把答案顶到下面看不见。
       收起来之后只剩一行「深度思考」,点一下还能展开。
  -->
  <div class="thinking-panel">
    <button
      type="button"
      class="thinking-head"
      :aria-expanded="expanded"
      @click="toggle"
    >
      <!-- 箭头:展开时朝下,收起时朝右 -->
      <DownOutlined class="thinking-caret" :class="{ 'is-folded': !expanded }" />
      <!-- 还在等模型:转圈(等得久了还有秒表) -->
      <LoadingDots v-if="isThinking" size="sm" label="正在思考" />
      <span class="thinking-title">{{ isThinking ? '正在思考…' : '深度思考' }}</span>
      <!--
        秒表:等久了报个时,用户能分清「在跑,只是慢」和「卡死了」。
        ⚠️ 5 秒以内不显示 —— 正常回答一两秒就出正文,秒表在那儿跳反而像坏了。
      -->
      <span v-if="isThinking && elapsed >= 5" class="thinking-elapsed">已等待 {{ elapsed }} 秒</span>
      <!-- 思考了多久(等完之后留个记录) -->
      <span v-else-if="!isThinking && elapsed > 0" class="thinking-elapsed">· {{ elapsed }} 秒</span>
    </button>

    <!--
      ⚠️ 用 v-if(不是 v-show):收起时正文**根本不渲染**。
         长对话里每条历史消息都可能带一整段思考链,
         全渲染的话 DOM 会被撑爆,而且每条都要跑一遍 Markdown 解析。
    -->
    <div v-if="expanded" ref="bodyRef" class="thinking-body">
      <StreamMarkdownRender :content="text" />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import LoadingDots from '@/components/LoadingDots.vue'
import StreamMarkdownRender from '@/components/StreamMarkdownRender.vue'

const props = defineProps({
  /** 后端流过来的思考链原文(是 Markdown,不是一个字一个字蹦出来的) */
  text: {
    type: String,
    default: '',
  },
  /**
   * 这一轮现在到哪一步了
   *
   * <p>'thinking' —— 模型还在想(正文一个字都没出来);
   *    'answering' —— 正文已经开始输出;
   *    'done'     —— 这一轮结束了。
   *
   * <p>由页面用 utils/thinking.js 的 phaseOf 算出来(两个页面的算法一样,
   *    别各写各的 —— 写岔了就会出现「正文都出来了还在转圈」)。
   */
  phase: {
    type: String,
    default: 'done',
  },
})

/** 还在等模型开口吗 */
const isThinking = computed(() => props.phase === 'thinking')

/**
 * 展开还是收起
 *
 * <p>⚠️ 初始值 = 是不是在思考:流式中的消息一上来就是展开的
 *    (正在流,当然看得见);历史消息是收起的(不然一屏全是思考链)。
 */
const expanded = ref(props.phase === 'thinking')

/**
 * 用户手动点过没有
 *
 * <p>点过之后就别再自动收起了 —— 用户主动展开就是想看,
 *    正文都出来了也不该被收走。
 */
let userToggled = false

const toggle = () => {
  userToggled = true
  expanded.value = !expanded.value
}

/**
 * 自动展开 / 收起
 *
 * <p>规则只有一条:**在思考的时候展开,别的时候收起**。
 *    「正文开始输出」那一刻自动收起 —— 思考链不用看了,答案才是重点。
 */
watch(
  () => isThinking.value,
  (thinking) => {
    if (userToggled) return
    expanded.value = thinking
  }
)

/**
 * 已等待多少秒
 *
 * <p>组件挂载 = 收到第一段思考链 = 模型开始想了,从这儿开始算。
 */
const elapsed = ref(0)
let timer = null

const startTimer = () => {
  if (timer) return
  timer = setInterval(() => {
    elapsed.value++
  }, 1000)
}

const stopTimer = () => {
  if (!timer) return
  clearInterval(timer)
  timer = null
}

// 秒表只在「等模型」的时候走 —— 正文都出来了还报「已等待 N 秒」是骗人
watch(isThinking, (thinking) => (thinking ? startTimer() : stopTimer()), { immediate: true })

onBeforeUnmount(stopTimer)

/**
 * 思考链在往下长,框里的滚动条要跟着走
 *
 * <p>不然新写的那段(往往是最关键的一段)在框外,用户看不到。
 *
 * <p>⚠️ 盯的是**元素的高度**而不是 text:
 *    正文是 Markdown 渲染出来的,渲染是异步的(要等 KaTeX / highlight.js 动态加载),
 *    text 变了的那一帧高度还没变 —— 盯 text 会漏掉最后一段。
 */
const bodyRef = ref(null)
let observer = null

watch(bodyRef, (el) => {
  observer?.disconnect()
  observer = null
  if (!el || !window.ResizeObserver) return
  observer = new ResizeObserver(() => {
    if (!isThinking.value) return
    // 用户自己往上翻了就别拽回去
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 24
    if (nearBottom) el.scrollTop = el.scrollHeight
  })
  observer.observe(el)
})

onBeforeUnmount(() => observer?.disconnect())
</script>

<style scoped>
.thinking-panel {
  margin-bottom: 6px;
}

/* 头部:一行小字,点一下展开/收起 */
.thinking-head {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 0;
  border: none;
  background: none;
  font-size: 12px;
  line-height: 18px;
  color: #6b7280;
  cursor: pointer;
  user-select: none;
  transition: color 0.15s ease;
}

.thinking-head:hover {
  color: #4b5563;
}

/* 箭头:展开朝下,收起朝右 */
.thinking-caret {
  font-size: 10px;
  transition: transform 0.15s ease;
}

.thinking-caret.is-folded {
  transform: rotate(-90deg);
}

/* 秒表:淡一点,别抢「正在思考…」的视线 */
.thinking-elapsed {
  color: #9ca3af;
}

/* 正文:左边一条竖线,内容按 Markdown 排 */
.thinking-body {
  margin-top: 4px;
  padding: 2px 0 2px 10px;
  border-left: 2px solid #e5e7eb;
  font-size: 13px;
  line-height: 1.7;
  color: #6b7280;
  /*
    限高 + 自己滚:
    思考链可能很长(一两屏),全铺开会把正文顶到下面看不见。
  */
  max-height: 320px;
  overflow-y: auto;
}

/*
  正文里的 Markdown 用面板的字号和颜色 ——
  StreamMarkdownRender 自带的那套是给**正文**用的(深色、16px),
  思考链要更小更淡,不然两段文字打架。
*/
.thinking-body :deep(.markdown-body) {
  color: inherit;
  line-height: inherit;
}
</style>
