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

    <!--
      底部输入框 —— 和聊天页共用同一个组件(ChatInputBox.vue)。
      ⚠️ 首页原来**没有**工具开关,于是首页的推荐问题写着「需要勾选天气工具」,
         可页面上根本没那个开关 —— 用户点了才发现工具没开,AI 只能瞎答。
         现在工具开关、模型选择、联网搜索都在输入框里,首页和聊天页是同一份。
    -->
    <div class="shrink-0 px-4 pb-4">
      <div class="mx-auto w-full max-w-2xl">
        <ChatInputBox
          ref="inputRef"
          v-model="message"
          :attachment="attachment"
          :busy="preparingImage"
          :send-disabled="sendState.disabled"
          :send-hint="sendState.hint"
          allow-image
          @send="send"
          @pick-image="pickImage"
          @remove-image="removeImage"
        />
        <DisclaimerBar />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import BrandLogo from '@/components/BrandLogo.vue'
import ChatInputBox from '@/components/ChatInputBox.vue'
import DisclaimerBar from '@/components/DisclaimerBar.vue'
import { conversationApi } from '@/api/conversation.js'
import { useAttachment } from '@/utils/attachment.js'
import { genUuid } from '@/utils/uuid.js'
import { sendToChat } from '@/utils/handoff.js'
import { useDraft } from '@/composables/useDraft.js'

const router = useRouter()

/** 首页的常用问题 */
const suggestions = [
  { title: '介绍一下你自己', desc: '看看小哈 AI 能做什么' },
  { title: '帮我查一下今天的天气', desc: '先在下面勾上「天气」工具' },
  { title: '解释一下 Vue 3 的组合式 API', desc: '技术问题随便问' },
  { title: '在 GitHub 上找找热门的 Vue 项目', desc: '先在下面勾上「GitHub」工具' },
]

/**
 * 输入框里的草稿
 *
 * <p>首页还不是一个会话,所以用 'home' 当它的标识 ——
 *    草稿存在本地,刷新页面也不丢(手快按一下 F5,打的字不会白打)。
 */
const HOME_SCOPE = 'home'
const { text: message } = useDraft(ref(HOME_SCOPE))

/** 输入框组件(要拿它的 focus) */
const inputRef = ref(null)

/** 待发送的图片(压缩、预览、回收都在 useAttachment 里) */
const { attachment, preparingImage, pickImage, removeImage, detachPreviewUrl } = useAttachment()

/** 正在建会话(等后端给 uuid)—— 这段时间里发送按钮置灰 */
const sending = ref(false)

/**
 * 发送按钮的状态:能不能发 + 发不了的话为什么
 *
 * <p>两个信息放一起算 —— 拆成两个 computed 的话,
 *    以后加一条规则忘了同步另一个,就会出现「按钮灰着却说不出为什么」。
 */
const sendState = computed(() => {
  if (preparingImage.value) return { disabled: true, hint: '正在压缩图片…' }
  // 正在建会话:这段时间里按钮要置灰,不然连点两下会建两个会话
  if (sending.value) return { disabled: true, hint: '正在创建会话…' }
  // 有图就能发(问题可以留空,让模型自己描述)
  if (attachment.value) return { disabled: false, hint: '' }
  if (!message.value.trim()) return { disabled: true, hint: '说点什么再发' }
  return { disabled: false, hint: '' }
})

/** 点建议卡片:把文字填进输入框,并把光标放过去让人改 */
const useSuggestion = async (s) => {
  message.value = s.title
  await nextTick()
  inputRef.value?.focus()
}

/**
 * 发送:建一个会话,然后跳到聊天页把它发出去
 *
 * <p>为什么是「先建会话再跳走」而不是「直接跳走让聊天页建」:
 *   建会话这一步(POST /chat/new)能拿到后端生成的 uuid,
 *   顺手就让左边栏出现这条会话 —— 用户能立刻看到「刚才那条被存下来了」。
 *
 * <p>⚠️ 建会话**不会**把这条消息存进消息表(它只是先占个坑),
 *    真正把消息发出去是聊天页的事。所以消息是「交接」过去的
 *    (交接细节见 utils/handoff.js)。
 *
 * <p>⚠️ 交接要**等建完会话再交**:交接的内容是认会话的(带 chatId),
 *    填早了的话还不知道该发给哪个会话;而且用户在这中间点了侧边栏别的会话,
 *    那条消息就会发到别的会话里去。
 */
const send = async () => {
  if (sendState.value.disabled) return

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

  // ⚠️ 预览地址的所有权交给聊天页 —— 这边就不能再回收了,
  //    不然组件一卸载(跳转)就把 URL revoke 掉,聊天页的缩略图会变裂图。
  //    必须在跳转**之前**交出去:跳转完这个组件就卸载了。
  if (file) detachPreviewUrl(file.previewUrl)

  message.value = ''
  attachment.value = null

  // 跳到聊天页,并把这条消息带过去
  sendToChat(router, {
    uuid,
    message: text,
    file: file ? file.file : null,
    previewUrl: file ? file.previewUrl : '',
  })
}
</script>
