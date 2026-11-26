/**
 * 输入框草稿 —— 每个会话各存各的
 *
 * <p>为什么要有这个:
 * <ul>
 *   <li><b>刷新页面不能丢</b> —— 用户打了一段话,手快按一下 F5,打的字全白打了。
 *       和「选了哪个模型」是同一类问题:用户以为页面记得,其实没记得。</li>
 *   <li><b>更严重的是草稿会串到别的会话</b> —— 路由切会话时页面组件是**复用**的
 *       (同一个组件,只是参数变了),所以输入框里的文字会原样跟过去:
 *       在会话 A 里写「帮我查天气」,点侧边栏切到会话 B,按发送 ——
 *       这句话就发到 B 里去了。各存各的才符合直觉。</li>
 * </ul>
 *
 * <p>怎么用:组件里用 {@link useDraft} 组合式函数(见 composables/useDraft.js),
 *    它负责「打字时防抖写盘」「切会话时换草稿」这些细节。
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import { safeStorage } from '@/utils/storage.js'
import { STORAGE_KEYS } from './keys.js'

/** 最多留多少个会话的草稿(超了就扔最老的) */
const MAX_DRAFTS = 50

export const useDraftStore = defineStore(
  'drafts',
  () => {
    /**
     * 草稿:{ 会话 id → { text, at } }
     *
     * <p>⚠️ 带上 at(写入时刻)是为了能扔掉最老的那几条 ——
     *    不然用得越久,这个对象越大,每次写盘都要整个序列化一遍。
     *
     * <p>⚠️ 首页的草稿用 'home' 这个 id(它还不是一个会话)。
     */
    const drafts = ref({})

    /**
     * 读一个会话的草稿
     *
     * @param {string} id 会话 id(首页是 'home')
     * @returns {string} 没有草稿时是空串
     */
    const get = (id) => drafts.value[id]?.text || ''

    /**
     * 存一个会话的草稿
     *
     * <p>⚠️ 空字符串**不存** —— 存了就是「这个会话有一段空草稿」,
     *    既占地方,又和「这个会话没有草稿」分不清。
     *
     * @param {string} id 会话 id
     * @param {string} text 草稿内容
     */
    const save = (id, text) => {
      if (!id) return
      const next = { ...drafts.value }
      if (!text) {
        delete next[id]
      } else {
        next[id] = { text, at: Date.now() }
      }
      // 超量了就扔最老的(整个对象一次换掉 → 只触发一次写盘)
      const keys = Object.keys(next)
      if (keys.length > MAX_DRAFTS) {
        keys
          .sort((a, b) => (next[b].at || 0) - (next[a].at || 0))
          .slice(MAX_DRAFTS)
          .forEach((k) => delete next[k])
      }
      drafts.value = next
    }

    /**
     * 删掉一个会话的草稿(消息发出去之后)
     *
     * @param {string} id 会话 id
     */
    const remove = (id) => {
      if (!id || !drafts.value[id]) return
      const next = { ...drafts.value }
      delete next[id]
      drafts.value = next
    }

    return { drafts, get, save, remove }
  },
  {
    persist: {
      key: STORAGE_KEYS.drafts,
      pick: ['drafts'],
      storage: safeStorage,
    },
  }
)
