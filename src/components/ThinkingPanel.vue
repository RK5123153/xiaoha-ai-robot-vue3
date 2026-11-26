<template>
  <!--
    等待模型回答时的「进度显示」—— 把后端流过来的思考链摆出来。

    ⚠️ 为什么要有这么一块:
       后端等模型开口的这段时间可能很长(要先调工具:天气 / 联网搜索,
       实测 MCP 工具挂住能到一两分钟),而这段时间里 SSE **一个字节都不发** ——
       光一个「正在思考…」,用户只会以为页面卡死了。
       但后端其实**一直在流思考链**(event: thinking),里面写着它在干什么:
       「我先并行查询北京、上海、广州、深圳、成都。」
       把它显示出来,这段等待就有了内容,用户知道模型在忙什么。

    ⚠️ 思考链**不混进正文**:
       它是模型的内部推理(还可能是英文的),单独一块、灰字、小字;
       正文那块保持干净 —— 见 ChatPage.vue 里它和 StreamMarkdownRender 是分开的两个元素。
  -->
  <div class="thinking-panel">
    <div class="thinking-head">
      <LoadingDots size="sm" label="正在思考" />
      <span class="thinking-title">正在思考…</span>
      <!--
        等得久了报个时:用户能分清「在跑,只是慢」和「卡死了」。
        ⚠️ 5 秒以内不显示 —— 正常回答一两秒就出正文,秒表在那儿跳反而像坏了。
      -->
      <span v-if="elapsed >= 5" class="thinking-elapsed">已等待 {{ elapsed }} 秒</span>
    </div>
    <p ref="bodyRef" class="thinking-body">{{ text }}</p>
  </div>
</template>

<script setup>
import { ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import LoadingDots from '@/components/LoadingDots.vue'

const props = defineProps({
  /** 后端流过来的思考链原文(纯文本,不是 Markdown) */
  text: {
    type: String,
    default: '',
  },
})

/**
 * 已经等了多久(秒)
 *
 * <p>组件挂载 = 开始等,所以直接从挂载时算起。
 */
const elapsed = ref(0)
let timer = null

onMounted(() => {
  timer = setInterval(() => {
    elapsed.value++
  }, 1000)
})

onBeforeUnmount(() => {
  clearInterval(timer)
})

/**
 * 思考链在往下长,框里的滚动条要跟着走
 *
 * <p>不然新写的那段(往往是最关键的一段)在框外,用户看不到。
 */
const bodyRef = ref(null)

watch(
  () => props.text,
  async () => {
    await nextTick()
    const el = bodyRef.value
    if (el) el.scrollTop = el.scrollHeight
  }
)
</script>

<style scoped>
.thinking-panel {
  margin-bottom: 6px;
  padding: 8px 10px;
  border-radius: 10px;
  background: #f7f8fa;
  border: 1px solid #eef0f3;
}

.thinking-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  line-height: 18px;
  color: #6b7280;
}

/* 秒表:淡一点,别抢「正在思考…」的视线 */
.thinking-elapsed {
  margin-left: auto;
  color: #9ca3af;
}

.thinking-body {
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 1.7;
  color: #9ca3af;
  /* 思考链里有换行,原样排 */
  white-space: pre-wrap;
  word-break: break-word;
  /*
    限高 + 自己滚:
    思考链可能很长(一两屏),全铺开会把正文顶到下面看不见。
  */
  max-height: 132px;
  overflow-y: auto;
}
</style>
