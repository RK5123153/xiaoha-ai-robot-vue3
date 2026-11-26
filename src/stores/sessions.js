/**
 * 会话列表 —— 左边栏的数据源
 *
 * <p>「左边栏」和「主内容区」是两个组件(Layout.vue / ChatPage.vue),
 *    但「当前有哪些会话」是两份都要知道的东西 —— 所以它得住在组件之外。
 *
 * <p>⚠️ 这份状态**不持久化**:会话是后端管的,页面打开时重新拉一次就行。
 *    存一份在浏览器里只会带来「列表是旧的」这种错觉。
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { conversationApi } from '@/api/conversation.js'
import { decodeSummary } from '@/utils/summary.js'

export const useSessionStore = defineStore('sessions', () => {
  /** 会话列表(按最后更新时间倒序) */
  const chats = ref([])
  /** 正在拉列表 */
  const loading = ref(false)
  /** 还有没有更早的会话 */
  const hasMore = ref(false)
  /** 下一页的游标 */
  const nextCursor = ref('')
  /** 列表已经拉过一次了(避免路由来回切时重复拉) */
  const loaded = ref(false)
  /** 拉列表的当口又有人要求「重新拉」→ 等这次拉完补一次 */
  const pendingReset = ref(false)

  /**
   * 会话列表里每一项的展示信息(标题、时间)
   *
   * @param {object} chat 后端返回的会话
   * @returns {{uuid: string, id: number, title: string, time: string, timeValue: number}}
   */
  const toListItem = (chat) => {
    const updateTime = chat?.updateTime || ''
    // 后端的时间格式是 "2026-11-25 11:03:26"(不带时区),Date 能直接解析
    const parsed = new Date(updateTime.replace(' ', 'T'))
    return {
      uuid: chat?.uuid || '',
      id: chat?.id,
      title: decodeSummary(chat?.summary) || '（无标题对话）',
      time: updateTime,
      timeValue: Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime(),
    }
  }

  /**
   * 按「今天 / 昨天 / 更早」分组
   *
   * <p>侧边栏全平铺的话,会话一多就找不到刚才聊的那个了。
   * 按时间分组是聊天产品最常见的做法。
   */
  const groupedChats = computed(() => {
    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const dayMs = 24 * 60 * 60 * 1000

    const buckets = [
      { label: '今天', items: [] },
      { label: '昨天', items: [] },
      { label: '更早', items: [] },
    ]

    chats.value.forEach((chat) => {
      const item = toListItem(chat)
      if (!item.uuid) return
      if (item.timeValue >= startOfToday) buckets[0].items.push(item)
      else if (item.timeValue >= startOfToday - dayMs) buckets[1].items.push(item)
      else buckets[2].items.push(item)
    })

    return buckets.filter((b) => b.items.length)
  })

  /**
   * 拉会话列表
   *
   * @param {object} [params]
   * @param {boolean} [params.reset] true = 重新从第一页拉(丢掉已加载的)
   * @returns {Promise<void>}
   */
  const loadChats = async ({ reset = false } = {}) => {
    // 正在拉:别并发拉两次,但「要重来」的请求得记下来,等这次拉完再补一次。
    // (发完消息会刷新列表,路由变了也会刷新 —— 两者很容易撞在一起)
    if (loading.value) {
      if (reset) pendingReset.value = true
      return
    }
    if (!reset && hasMore.value && !nextCursor.value) return

    loading.value = true
    try {
      const res = await conversationApi.list({
        size: 20,
        cursor: reset ? '' : nextCursor.value,
      })
      if (reset) {
        chats.value = res.items
      } else {
        // 游标翻页可能有重复(后端按 updateTime 排序,翻页期间又聊了新消息),
        // 按 uuid 去重再拼
        const seen = new Set(chats.value.map((c) => c.uuid))
        chats.value = [
          ...chats.value,
          ...res.items.filter((c) => c.uuid && !seen.has(c.uuid)),
        ]
      }
      hasMore.value = res.hasMore
      nextCursor.value = res.nextCursor
      loaded.value = true
    } catch (e) {
      console.error('拉会话列表失败: ', e)
    } finally {
      loading.value = false
      // 刚才有人要求「重新拉」→ 补一次
      if (pendingReset.value) {
        pendingReset.value = false
        loadChats({ reset: true })
      }
    }
  }

  /**
   * 删掉一个会话(本地列表也一起删)
   *
   * @param {string} uuid
   * @returns {Promise<boolean>}
   */
  const removeChat = async (uuid) => {
    const ok = await conversationApi.remove({ uuid })
    if (ok) {
      chats.value = chats.value.filter((c) => c.uuid !== uuid)
    }
    return ok
  }

  /**
   * 改名(本地列表也一起改)
   *
   * @param {number} id 会话的数字 id
   * @param {string} summary 新标题
   * @returns {Promise<string>} 实际生效的标题
   */
  const renameChat = async (id, summary) => {
    const res = await conversationApi.rename({ id, summary })
    chats.value = chats.value.map((c) =>
      c.id === id ? { ...c, summary: res.summary } : c
    )
    return res.summary
  }

  return {
    chats,
    loading,
    hasMore,
    nextCursor,
    loaded,
    groupedChats,
    loadChats,
    removeChat,
    renameChat,
  }
})
