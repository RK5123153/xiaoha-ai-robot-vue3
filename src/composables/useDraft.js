/**
 * 输入框草稿 —— 每个会话各存各的,刷新也不丢
 *
 * <p>用起来很简单:
 * <pre>
 * const { message } = useDraft(chatId)   // chatId 是个 ref(首页传 'home' 的 ref)
 * // &lt;ChatInputBox v-model="message" /&gt;
 * </pre>
 *
 * <p>它替页面干了三件不好做的事:
 * <ul>
 *   <li><b>打字时防抖写盘</b> —— 每敲一个字就往 localStorage 写一遍太浪费
 *       (整个草稿表都要序列化一次)。攒 500ms 再写。</li>
 *   <li><b>切会话时换草稿</b> —— 旧会话的存下来,新会话的读出来。
 *       (路由切会话时页面组件是复用的,不换的话草稿会跟着跑到别的会话里去。)</li>
 *   <li><b>离开页面时补写</b> —— 切走/关标签页时把还没写的那一下补上,
 *       不然最后几百毫秒打的字会丢。</li>
 * </ul>
 */

import { ref, watch, onBeforeUnmount } from 'vue'
import { useDraftStore } from '@/stores/drafts.js'

/** 攒多久再写盘(ms) */
const SAVE_DELAY = 500

/**
 * 绑定一个「按会话分开」的草稿
 *
 * @param {import('vue').Ref<string>} scope 会话标识;首页传一个值为 'home' 的 ref
 * @returns {{text: import('vue').Ref<string>}} text 是输入框绑的那个 ref
 */
export const useDraft = (scope) => {
  const draftStore = useDraftStore()

  /** 输入框里的文字 */
  const text = ref(draftStore.get(scope.value))

  /** 待写的定时器 */
  let timer = null

  /** 立刻把当前文字存到 scope 下面 */
  const persist = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    draftStore.save(scope.value, text.value)
  }

  /** 攒一会儿再写(打字过程中用) */
  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(persist, SAVE_DELAY)
  }

  // 文字变了 → 攒着写
  watch(text, schedule)

  // 切会话:旧会话的存下来,换成新会话的
  // ⚠️ 这里读到的 text.value 还是**旧会话**的文字(还没被换掉)→ 正好存到旧会话名下
  watch(scope, (next, prev) => {
    if (prev) draftStore.save(prev, text.value)
    text.value = draftStore.get(next)
  })

  // 关标签页/切走时补写最后一下(否则最后几百毫秒打的字会丢)
  const onPageHide = () => {
    if (timer) persist()
  }
  window.addEventListener('pagehide', onPageHide)

  onBeforeUnmount(() => {
    window.removeEventListener('pagehide', onPageHide)
    persist()
  })

  return { text }
}
