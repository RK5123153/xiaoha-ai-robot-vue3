<template>
  <!--
    「内容由 AI 生成,请仔细甄别」的免责提示。

    ⚠️ 为什么不是 Layout 里那个 `position: fixed; bottom: 0` 的条:
       输入框就钉在视口底边,fixed 的提示条会**压在输入框上面**(文字糊在输入框里)。
       它必须跟着输入框走 —— 所以放在「输入框那一列」的最后一行,而不是视口底部。
  -->
  <p class="disclaimer">内容由 AI 生成，请仔细甄别</p>
</template>

<script setup>
/**
 * 免责提示条
 *
 * <p>单独抽成组件是因为首页和聊天页各有一份 —— 两份文案迟早会不一样
 * (改了一处忘了另一处),这种「只有一行字」的东西最容易被复制出两份。
 *
 * <p>不需要这个提示的页面,直接别写这个组件就行(不用加 prop 来关)。
 */
</script>

<style scoped>
.disclaimer {
  margin-top: 8px;
  text-align: center;
  font-size: 12px;
  line-height: 16px;
  color: #9ca3af;
}
</style>
