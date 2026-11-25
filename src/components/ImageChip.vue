<template>
  <!--
    已选图片的缩略图条：缩略图 + 文件名 + 体积 + 移除按钮

    展示的是**压缩之后**的那张（也就是真正发给模型的那张），
    所见即所得 —— 用户看到的图和模型看到的图是同一张。
  -->
  <div class="image-chip">
    <img
      v-if="attachment?.previewUrl"
      :src="attachment.previewUrl"
      :alt="attachment.name || '待发送的图片'"
      class="thumb"
      @click="$emit('preview')"
    />
    <div class="min-w-0 flex-1">
      <p class="name truncate">{{ attachment?.name || '图片' }}</p>
      <p class="meta">
        <span v-if="busy" class="text-gray-400">正在压缩…</span>
        <span v-else>{{ formatBytes(attachment?.size || 0) }}</span>
      </p>
    </div>
    <button
      type="button"
      class="remove-btn"
      title="移除图片"
      aria-label="移除图片"
      @click="$emit('remove')"
    >
      <CloseOutlined class="text-[14px]" />
    </button>
  </div>
</template>

<script setup>
import { formatBytes } from '@/utils/image.js'

defineProps({
  /** { previewUrl, name, size } */
  attachment: {
    type: Object,
    default: null,
  },
  /** 正在压缩(大图要缩放,有个几百毫秒的空档) */
  busy: {
    type: Boolean,
    default: false,
  },
})

defineEmits(['remove', 'preview'])
</script>

<style scoped>
.image-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 10px;
  background: #fff;
  border: 1px solid #e5e7eb;
}

.thumb {
  width: 36px;
  height: 36px;
  border-radius: 6px;
  object-fit: cover;
  flex-shrink: 0;
  cursor: zoom-in;
  background: #f3f4f6;
}

.name {
  font-size: 12px;
  line-height: 16px;
  color: #374151;
}

.meta {
  font-size: 11px;
  line-height: 14px;
  color: #9ca3af;
}

.remove-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  border-radius: 6px;
  color: #9ca3af;
  background: transparent;
  border: none;
  cursor: pointer;
  transition: color 0.15s ease, background-color 0.15s ease;
}

.remove-btn:hover {
  color: #4b5563;
  background: rgba(0, 0, 0, 0.04);
}
</style>
