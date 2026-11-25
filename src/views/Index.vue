<template>
  <div class="flex-1 flex flex-col overflow-hidden">
    <!-- 中间的欢迎区 -->
    <div class="flex-1 min-h-0 flex flex-col items-center justify-center px-4 pt-6">
      <div class="w-full max-w-2xl">
        <div class="flex items-center gap-3">
          <div class="w-11 h-11 rounded-full flex items-center justify-center border border-gray-200 shrink-0">
            <BrandLogo class="w-6 h-6" />
          </div>
          <div>
            <h1 class="text-xl sm:text-2xl font-semibold text-gray-900">你好，我是小哈 AI 助手 ✨</h1>
            <p class="text-sm text-gray-500 mt-0.5">问问题、查天气、翻代码 —— 想聊点什么？</p>
          </div>
        </div>

        <!-- 常用问题:点一下填进输入框(不直接发送,让人改一改再发) -->
        <div class="grid sm:grid-cols-2 gap-2.5 mt-7">
          <button
            v-for="s in suggestions"
            :key="s.title"
            type="button"
            class="text-left px-4 py-3 rounded-xl border border-gray-200 bg-white
                   hover:border-[#4d6bfe] hover:bg-gray-50 transition-colors group"
            @click="useSuggestion(s)"
          >
            <p class="text-sm font-medium text-gray-800 group-hover:text-[#4d6bfe] transition-colors">
              {{ s.title }}
            </p>
            <p class="text-xs text-gray-400 mt-1">{{ s.desc }}</p>
          </button>
        </div>
      </div>
    </div>

    <!-- 底部输入框 -->
    <div class="shrink-0 px-4 pb-4">
      <div class="mx-auto w-full max-w-2xl">
        <div
          class="bg-gray-100 rounded-3xl px-4 py-3 flex flex-col
                 border border-gray-200 transition-colors"
          :class="{ 'is-dropping': isDragOver }"
          @dragenter.prevent="onDragEnter"
          @dragover.prevent
          @dragleave.prevent="onDragLeave"
          @drop.prevent="onDrop"
          @paste="onPaste"
        >
          <!-- 已选中的图片 -->
          <div v-if="attachment" class="mb-2">
            <ImageChip
              :attachment="attachment"
              :busy="preparingImage"
              @remove="clearAttachment"
              @preview="openPreview(attachment)"
            />
          </div>

          <textarea
            v-model="message"
            placeholder="给小哈 AI 机器人发送消息（Enter 发送，Shift + Enter 换行）"
            class="bg-transparent border-none outline-none w-full text-sm resize-none min-h-[24px]"
            rows="2"
            @input="autoResize"
            @keydown="handleKeydown"
            @compositionstart="handleCompositionStart"
            @compositionend="handleCompositionEnd"
            ref="textareaRef"
          ></textarea>

          <div class="flex justify-end items-center gap-2 mt-1">
            <ImagePicker :disabled="preparingImage" @pick="onPickImage" />
            <button
              type="button"
              @click="send"
              :disabled="sendDisabled"
              aria-label="发送消息"
              title="发送（Enter）"
              class="flex items-center justify-center bg-[#4d6bfe] text-white rounded-full w-8 h-8
                     border border-[#4d6bfe] hover:bg-[#3b5bef] transition-colors
                     disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-[#4d6bfe]"
            >
              <ArrowUpOutlined class="text-xl" />
            </button>
          </div>
        </div>
        <div class="flex items-center justify-center text-xs text-gray-400 mt-2">内容由 AI 生成，请仔细甄别</div>
      </div>
    </div>

    <!-- 轻提示用 antd 的 message(见 App.vue 的 message.config) -->

    <!-- 图片放大预览 -->
    <div v-if="previewUrl" class="preview-overlay" @click="previewUrl = ''">
      <img :src="previewUrl" class="preview-img" alt="预览" @click.stop />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useRouter } from 'vue-router'
// 这里起别名:页面里已经有叫 message 的变量(输入框的草稿)
import { message as antMessage } from 'ant-design-vue'
import BrandLogo from '@/components/BrandLogo.vue'
import ImagePicker from '@/components/ImagePicker.vue'
import ImageChip from '@/components/ImageChip.vue'
import { conversationApi } from '@/utils/api.js'
import { prepareImage, isImageFile } from '@/utils/image.js'
import { handoff, genUuid } from '@/utils/chat-store.js'

const router = useRouter()

/** 首页的常用问题 */
const suggestions = [
  { title: '介绍一下你自己', desc: '看看小哈 AI 能做什么' },
  { title: '帮我查一下今天的天气', desc: '需要勾选「天气」工具' },
  { title: '解释一下 Vue 3 的组合式 API', desc: '技术问题随便问' },
  { title: '在 GitHub 上找找热门的 Vue 项目', desc: '需要勾选「GitHub」工具' },
]

const message = ref('')
const textareaRef = ref(null)
const attachment = ref(null)
const preparingImage = ref(false)
const isDragOver = ref(false)
const previewUrl = ref('')

/** 正在建会话(等后端给 uuid)—— 这段时间里发送按钮置灰 */
const sending = ref(false)

/** 轻提示文案（空字符串 = 不显示） */

/** 输入框最大高度（px）。超过就在输入框内部滚动，不把整个页面挤爆 */
const MAX_INPUT_HEIGHT = 300

/**
 * 自动调整文本域高度
 *
 * 关键点：
 * 1. 先把 height 归零再量 scrollHeight —— 否则删字时高度只增不减，框会越撑越大
 * 2. 量到的高度要封顶，超过 MAX_INPUT_HEIGHT 就让输入框自己滚
 */
const autoResize = () => {
  const textarea = textareaRef.value
  if (!textarea) return
  textarea.style.height = 'auto'
  const contentHeight = textarea.scrollHeight
  textarea.style.height = Math.min(contentHeight, MAX_INPUT_HEIGHT) + 'px'
  textarea.style.overflowY = contentHeight > MAX_INPUT_HEIGHT ? 'auto' : 'hidden'
}

/** 输入法组字状态：中文输入法选词时会触发 Enter，必须和「发送」区分开 */
const isComposing = ref(false)
/** 最近一次输入法结束的时间戳：部分浏览器在 compositionend 之后还会补发一个 Enter */
let composingEndedAt = 0

const handleCompositionStart = () => {
  isComposing.value = true
}

const handleCompositionEnd = () => {
  isComposing.value = false
  composingEndedAt = Date.now()
}

/**
 * 键盘事件：Enter 发送，Shift+Enter 换行
 *
 * ⚠️ 中文输入法（最容易被忽略的坑）：
 *   用拼音打字时按 Enter 是「选词」，不是「发送」。不加判断的话，
 *   用户每选一次词就会把半句话发出去。
 */
const handleKeydown = (e) => {
  if (e.key !== 'Enter') return
  if (e.isComposing || e.keyCode === 229 || isComposing.value) return
  if (Date.now() - composingEndedAt < 100) return
  if (e.shiftKey) return
  e.preventDefault()
  send()
}

/** 点建议卡片:把文字填进输入框,并把光标放过去让人改 */
const useSuggestion = async (s) => {
  message.value = s.title
  await nextTick()
  autoResize()
  textareaRef.value?.focus()
}

/* ──────────────────────────────────────────────────────────────────────
 * 图片:选择、压缩、预览
 * ────────────────────────────────────────────────────────────────────── */

/** 创建过的 object URL(统一在组件卸载时回收) */
const objectUrls = []

/** 释放一个 object URL（如果还有消息在用它，就留着） */
const releaseObjectUrl = (url) => {
  if (!url) return
  const i = objectUrls.indexOf(url)
  if (i !== -1) {
    objectUrls.splice(i, 1)
    URL.revokeObjectURL(url)
  }
}

/** 选好一张图（点了按钮 / 粘贴 / 拖拽都走这里） */
const onPickImage = async (file) => {
  if (!file || preparingImage.value) return
  preparingImage.value = true
  try {
    const { file: prepared } = await prepareImage(file)
    const previewUrl = URL.createObjectURL(prepared)
    objectUrls.push(previewUrl)

    const old = attachment.value
    attachment.value = {
      id: genUuid(),
      file: prepared,
      previewUrl,
      name: prepared.name,
      size: prepared.size,
    }
    if (old) releaseObjectUrl(old.previewUrl)
  } catch (e) {
    console.error('图片处理失败: ', e)
    antMessage.info(e.message || '这个文件不能当图片用')
  } finally {
    preparingImage.value = false
  }
}

/** 移除待发送的图片 */
const clearAttachment = () => {
  const old = attachment.value
  attachment.value = null
  if (old) releaseObjectUrl(old.previewUrl)
}

/** 拖拽进入计数器：dragenter/dragleave 会在子元素间反复触发，用计数才不会闪 */
let dragDepth = 0

const onDragEnter = () => {
  dragDepth++
  isDragOver.value = true
}

const onDragLeave = () => {
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) isDragOver.value = false
}

/** 放下文件(只认图片) */
const onDrop = (e) => {
  dragDepth = 0
  isDragOver.value = false
  const files = e.dataTransfer?.files || []
  for (const f of files) {
    if (isImageFile(f)) {
      onPickImage(f)
      return
    }
  }
  antMessage.info('只能把图片拖进来')
}

/** 粘贴图片（截图工具 / 右键复制图片） */
const onPaste = (e) => {
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (item.kind === 'file' && item.type?.startsWith('image/')) {
      const file = item.getAsFile()
      if (file) {
        onPickImage(file)
        return
      }
    }
  }
}

const openPreview = (image) => {
  if (image?.previewUrl) previewUrl.value = image.previewUrl
}

/** Esc 关掉预览 */
const handlePreviewKeydown = (e) => {
  if (e.key === 'Escape') previewUrl.value = ''
}

onMounted(() => {
  autoResize()
  textareaRef.value?.focus()
  window.addEventListener('keydown', handlePreviewKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handlePreviewKeydown)
  objectUrls.forEach((url) => URL.revokeObjectURL(url))
  objectUrls.length = 0
})

/** 发送按钮该不该禁用 */
const sendDisabled = computed(() => {
  if (preparingImage.value) return true
  // 正在建会话:这段时间里按钮要置灰,不然连点两下会建两个会话
  if (sending.value) return true
  // 有图就能发(问题可以留空,让模型自己描述)
  if (attachment.value) return false
  return !message.value.trim()
})

/**
 * 发送:建一个会话,然后跳到聊天页把它发出去
 *
 * <p>为什么是「先建会话再跳走」而不是「直接跳走让聊天页建」:
 *   建会话这一步(POST /chat/new)能拿到后端生成的 uuid,
 *   顺手就让左边栏出现这条会话 —— 用户能立刻看到「刚才那条被存下来了」。
 *
 * <p>⚠️ 建会话**不会**把这条消息存进消息表(它只是先占个坑),
 *    真正把消息发出去是聊天页的事。所以消息是通过 handoff 交接过去的。
 *
 * <p>⚠️ 交接的内容要**等建完会话再填**:填早了的话,
 *    用户在这中间点了侧边栏别的会话,那条消息就会发到别的会话里去。
 */
const send = async () => {
  if (sendDisabled.value) return

  const text = message.value.trim()
  const file = attachment.value

  sending.value = true
  let uuid = ''
  try {
    const created = await conversationApi.create({ message: text || '看这张图' })
    uuid = created.uuid
  } catch (e) {
    // 建会话失败也别把用户卡住:自己造一个 id,后端照样能存
    console.error('新建会话失败: ', e)
    uuid = genUuid()
  } finally {
    sending.value = false
  }
  if (!uuid) uuid = genUuid()

  // 把要发的东西交给聊天页
  handoff.message = text
  handoff.file = file ? file.file : null
  handoff.previewUrl = file ? file.previewUrl : ''

  // ⚠️ 预览地址的所有权交给聊天页 —— 这边就不能再回收了,
  //    不然组件一卸载(跳转)就把 URL  revoke 掉,聊天页的缩略图会变裂图。
  if (file) {
    const i = objectUrls.indexOf(file.previewUrl)
    if (i !== -1) objectUrls.splice(i, 1)
  }

  message.value = ''
  attachment.value = null

  router.push(`/chat/${uuid}`)
}
</script>

<style scoped>
/* 拖拽悬停：告诉用户「可以放这儿」 */
.is-dropping {
  background: #eff6ff;
  border-color: #4d6bfe;
}

/* 图片放大预览 */
.preview-overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
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
