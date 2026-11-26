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
  /** 一页拉多少个会话 */
  const PAGE_SIZE = 20

  /** 会话列表(按最后更新时间倒序) */
  const chats = ref([])
  /** 正在拉列表 */
  const loading = ref(false)
  /** 还有没有更早的会话 */
  const hasMore = ref(false)
  /** 下一页的游标 */
  const nextCursor = ref('')
  /**
   * 已经翻了几页(1 = 只加载了最新的一页)
   *
   * <p>⚠️ 这个数是「刷新列表时用哪个游标」的关键:
   *    翻过好几页之后,手里那个游标指着的是「**已加载的最旧那条之后**」——
   *    刷新(重新拉第一页)时不能把它换成新响应里的游标,不然下次「加载更多」
   *    会把已经加载过的第二页**再要一遍**,去重之后列表没长,用户看着像「点了没反应」。
   */
  const pagesLoaded = ref(1)
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
   * 某个会话的标题
   *
   * <p>侧边栏和聊天页顶栏显示的是**同一份**标题 ——
   *    两边各算一套的话,改名的效果就只会在一边出现。
   *
   * @param {string} uuid
   * @returns {string} 找不到就是空串(调用方自己给个兜底文案)
   */
  const titleOf = (uuid) => {
    const chat = chats.value.find((c) => c.uuid === uuid)
    return chat ? decodeSummary(chat.summary) : ''
  }

  /**
   * 拉会话列表
   *
   * @param {object} [params]
   * @param {boolean} [params.reset] true = 重新拉最新的一页(标题/时间刷新);
   *                                   false = 接着往下翻一页
   * @returns {Promise<boolean>} 这次拉成功了吗(失败时列表原样不动)
   */
  const loadChats = async ({ reset = false } = {}) => {
    // 正在拉:别并发拉两次,但「要重来」的请求得记下来,等这次拉完再补一次。
    // (发完消息会刷新列表,路由变了也会刷新 —— 两者很容易撞在一起)
    if (loading.value) {
      if (reset) pendingReset.value = true
      return false
    }
    // ⚠️ 「往下翻」但没有游标了 → 没什么可拉的
    //    (后端翻到底时不再给游标;hasMore=false 也是同一个意思)
    if (!reset && (!hasMore.value || !nextCursor.value)) return false

    // ⚠️ 重置(只拉最新的一页)时,「接着往下翻」要用**哪个游标**?
    //    · 只加载过第一页 → 用这次响应里的游标(它指着第一页最旧那条之后);
    //    · 已经翻过好几页 → 手里那个游标指着「已加载的最旧那条之后」,那才是要接着翻的位置。
    //      换掉它的话,下次「加载更多」会把已经加载过的第二页**再要一遍**,
    //      去重之后列表没长,用户看着像「点了没反应」。
    //    (后端的游标锚在 (update_time, id) 上,是绝对位置不是偏移量 ——
    //     所以刷新第一页不会把游标「顶歪」,它照样指着原来那条。)
    const prevCursor = nextCursor.value
    const prevHasMore = hasMore.value
    const keepCursor = reset && pagesLoaded.value > 1

    loading.value = true
    try {
      const res = await conversationApi.list({
        size: PAGE_SIZE,
        cursor: reset ? '' : nextCursor.value,
      })
      if (reset) {
        // ⚠️ 重置**不能**把列表整个换掉 —— 换掉的话:
        //    用户往下翻了好几页,点一下会话(路由一变就重置)→ 列表被砍回第一页,
        //    滚动位置也跳回顶上,刚才翻过的那些全白翻了。
        //    所以是「**合并**」:新的一页放最前面,已经加载过的更早的接在后面。
        //
        //    (后端按 update_time 倒序排,新的一页一定比旧页都新 ——
        //     掉出第一页的旧会话跟着「更早」那一段走,顺序不会乱。)
        const fresh = new Set(res.items.map((c) => c.uuid))
        chats.value = [...res.items, ...chats.value.filter((c) => !fresh.has(c.uuid))]
        // 旧页还留着 → 页数不变(游标还指着它们之后)
        if (!keepCursor) pagesLoaded.value = 1
      } else {
        // 游标翻页可能有重复(后端按 updateTime 排序,翻页期间又聊了新消息),
        // 按 uuid 去重再拼
        const seen = new Set(chats.value.map((c) => c.uuid))
        chats.value = [
          ...chats.value,
          ...res.items.filter((c) => c.uuid && !seen.has(c.uuid)),
        ]
        pagesLoaded.value += 1
      }
      hasMore.value = keepCursor ? prevHasMore : res.hasMore
      nextCursor.value = keepCursor ? prevCursor : res.nextCursor
      loaded.value = true
      return true
    } catch (e) {
      console.error('拉会话列表失败: ', e)
      return false
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
    titleOf,
    loadChats,
    removeChat,
    renameChat,
  }
})
