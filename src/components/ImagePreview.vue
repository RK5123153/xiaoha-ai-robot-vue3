<template>
  <!--
    图片放大预览(点遮罩或按 Esc 关闭)

    ⚠️ 用 <Teleport to="body"> 挂到 body 上,而不是就地渲染:
       页面里到处是 overflow-hidden 的容器(聊天区、布局),
       就地渲染的话遮罩会被祖先裁掉 —— 表现是「点了图片,只看到图片变大了一点点」。
  -->
  <Teleport to="body">
    <div class="preview-overlay" @click="$emit('close')">
      <img :src="url" class="preview-img" alt="预览" @click.stop />
    </div>
  </Teleport>
</template>

<script setup>
import { onMounted, onBeforeUnmount } from 'vue'

defineProps({
  /** 要放大的图片地址 */
  url: {
    type: String,
    default: '',
  },
})

const emit = defineEmits(['close'])

/**
 * Esc 关掉预览
 *
 * <p>监听挂在 window 上:预览是 Teleport 到 body 的,
 *    挂在触发它的元素上收不到事件(焦点可能根本不在那儿)。
 */
const onKeydown = (e) => {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
.preview-overlay {
  position: fixed;
  inset: 0;
  /* 比页面上的东西(z-30/z-40)都高,但别盖住 antd 的弹层 */
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(17, 24, 39, 0.75);
  cursor: zoom-out;
}

.preview-img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  border-radius: 8px;
  cursor: default;
}
</style>
