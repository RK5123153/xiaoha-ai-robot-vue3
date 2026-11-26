<template>
  <!--
    等待反馈:三个依次跳动的圆点。

    ⚠️ 为什么不用 antd 的 <a-spin>:
       Spin 是「转圈 + 一圈虚线」的图标,适合「整个区域在加载」;
       但这里等的是「模型开口说第一句话」——
       它要**贴在正文旁边**,尺寸很小、颜色跟着正文走。
       Spin 自带一圈描边,缩到这么小会糊成一团,看着像加载失败。

    ⚠️ 教程里那版照抄会踩的坑:
       · 关键帧写的是 `0%, 80%, 100% { opacity: 0 }` —— 一个周期里 80% 的时间
         三个点**全都看不见**,屏幕上一片空白,比没有动画还像卡死。
         这儿改成「一直有个淡淡的点在,只有一个点在跳」。
       · 没有 prefers-reduced-motion —— 前庭功能障碍的用户看闪烁动画会难受,
         浏览器里关掉动画后要还能表达「在等」。
       · 没有无障碍语义 —— 屏幕阅读器用户完全不知道模型正在思考。
  -->
  <span class="loading-dots" :class="{ 'is-sm': size === 'sm' }" role="status">
    <!-- 屏幕阅读器读这一句;圆点对它没意义,aria-hidden 掉 -->
    <span class="sr-only">{{ label }}</span>
    <span class="dots" aria-hidden="true">
      <!-- --i 是「第几个点」:动画的错峰和静息时的深浅都靠它 -->
      <span class="dot" :style="{ '--i': 0 }"></span>
      <span class="dot" :style="{ '--i': 1 }"></span>
      <span class="dot" :style="{ '--i': 2 }"></span>
    </span>
  </span>
</template>

<script setup>
/**
 * 加载动画(三个跳动的点)
 *
 * <p>用在「等模型回答」这种地方 —— 气泡里一个点,不代表任何进度,
 *    只代表「还活着,别以为卡了」。
 */
defineProps({
  /**
   * 屏幕阅读器读出来的文字(视觉上不显示)
   *
   * <p>⚠️ 别省掉:圆点是纯视觉的,读屏用户看不到它,
   *    没这句话就等于完全不知道模型正在思考。
   */
  label: {
    type: String,
    default: '加载中',
  },
  /** 圆点大小:'sm'(气泡里) | 'md'(页面居中) */
  size: {
    type: String,
    default: 'md',
  },
})
</script>

<style scoped>
.loading-dots {
  display: inline-flex;
  align-items: center;
  /* 颜色跟着外层的文字走 —— 气泡里是灰的就灰的,别的地方要蓝的就是蓝的 */
  color: inherit;
}

.dots {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.dot {
  width: var(--dot-size, 6px);
  height: var(--dot-size, 6px);
  border-radius: 50%;
  background: currentColor;
  /*
    静息状态(动画没跑起来 / 用户关了动画)也有深浅区别,
    不然三个点糊成一坨,看不出是三个。
  */
  opacity: calc(0.3 + var(--i) * 0.35);
  /* backwards:错峰的那一小段时间里用第 0 帧,别闪一下 */
  animation: dot-bounce 1.25s infinite ease-in-out backwards;
  animation-delay: calc(var(--i) * 0.16s);
}

/* 小号:贴在气泡正文旁边用 */
.loading-dots.is-sm {
  --dot-size: 5px;
}

@keyframes dot-bounce {
  0%,
  70%,
  100% {
    opacity: 0.25;
    transform: translateY(0);
  }
  35% {
    opacity: 1;
    transform: translateY(-3px);
  }
}

/*
  尊重「减少动态效果」的设置(系统里开了「减少动画」就会命中):
  圆点不再跳,但**保留深浅** —— 还是能看出「在等」,
  比整个指示器消失(用户以为卡死了)好。
*/
@media (prefers-reduced-motion: reduce) {
  .dot {
    animation: none;
  }
}
</style>
