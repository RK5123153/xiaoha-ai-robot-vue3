<template>
  <!--
    联网搜索的来源 —— 后端 event: source 下发的(标题 + 链接)。

    ⚠️ 为什么要单独一块:
       联网搜索的回答是「查过网」的,但正文里往往只是结论 ——
       用户想知道「这话是哪儿来的」就得有一份来源清单。
       后端本来就把来源带回来了(见后端 WebSearchSupport.sourcesOf),
       ⚠️ 之前前端**根本没接**这个事件 —— 后端发的东西没人看,等于白做。

    ⚠️ 为什么默认收起:
       来源是**补充信息**,不是回答本身 —— 摊开会把答案顶到下面看不见
       (和思考链面板一个道理)。点一下展开。

    ⚠️ 来源**不归档**:后端没把它存进数据库,刷新页面就看不到了。
       它是一次性的「参考资料」,不是回答的一部分 —— 别指望刷新后还在。
  -->
  <div class="source-list">
    <button type="button" class="source-head" :aria-expanded="expanded" @click="toggle">
      <!-- 箭头:展开时朝下,收起时朝右 -->
      <DownOutlined class="source-caret" :class="{ 'is-folded': !expanded }" />
      <span>联网搜索的来源（{{ sources.length }}）</span>
    </button>

    <!--
      ⚠️ 用 v-if(不是 v-show):来源可能一二十条,收起时根本不渲染 ——
         长对话里每条消息都带一份来源,全渲染 DOM 会被撑爆。
    -->
    <ol v-if="expanded" class="source-body">
      <li v-for="(s, i) in sources" :key="i" class="source-item">
        <a :href="s.url" target="_blank" rel="noopener noreferrer">{{ s.title || s.url }}</a>
      </li>
    </ol>
  </div>
</template>

<script setup>
import { ref } from 'vue'

const props = defineProps({
  /**
   * 来源列表 —— [{title, url}]
   *
   * <p>形状由后端定(见后端 StreamPayload.sources),前端只多留一个 title 兜底:
   * 有的来源只有链接没有标题,那时候拿链接当标题显示,总比一条空行强。
   */
  sources: {
    type: Array,
    default: () => [],
  },
})

/** 展开还是收起 —— 默认收起(来源是补充信息,别把答案顶下去) */
const expanded = ref(false)

const toggle = () => {
  expanded.value = !expanded.value
}
</script>

<style scoped>
.source-list {
  margin-top: 6px;
}

/* 头部:一行小字,点一下展开/收起(和思考链面板一个调子) */
.source-head {
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

.source-head:hover {
  color: #4b5563;
}

/* 箭头:展开朝下,收起朝右 */
.source-caret {
  font-size: 10px;
  transition: transform 0.15s ease;
}

.source-caret.is-folded {
  transform: rotate(-90deg);
}

/* 列表:左边一条竖线,跟思考链面板的排版一致 */
.source-body {
  margin-top: 4px;
  padding: 2px 0 2px 10px;
  border-left: 2px solid #e5e7eb;
  font-size: 13px;
  line-height: 1.7;
  list-style: none;
  counter-reset: source;
}

.source-item {
  margin: 0;
}

/* 序号:用 CSS counter,不污染 DOM */
.source-item::before {
  counter-increment: source;
  content: counter(source) '. ';
  color: #9ca3af;
}

.source-item :deep(a),
.source-item a {
  color: #4b5563;
  text-decoration: underline;
  text-underline-offset: 2px;
  word-break: break-all;
}

.source-item a:hover {
  color: #2563eb;
}
</style>
