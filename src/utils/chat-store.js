/**
 * 会话状态(侧边栏 + 页面之间的交接)
 *
 * <p>为什么要有这么一个「全局状态」:
 * <ul>
 *   <li><b>左边栏和主内容区是两个组件</b>(Layout.vue / ChatPage.vue),
 *       但「当前有哪些会话」「选了哪个模型」是两份都要知道的东西。</li>
 *   <li><b>首页 → 聊天页要交接一条消息</b>:
 *       用户在首页输入框打了一句话,点发送后要跳到聊天页并把这句话发出去。
 *       走 URL 不合适(长文本 + 中文 + 转义),走组件 props 也不行(跨路由了),
 *       所以放在这里,聊天页 mount 时取走。</li>
 * </ul>
 *
 * <p>没有引 Pinia —— 这个项目一共就这两个页面,
 * 一个 reactive 对象 + 几个函数完全够用,不值得为它加一个依赖。
 */

import { reactive, computed } from 'vue'
import { conversationApi, modelApi, chatApi } from './api.js'

/** 会话列表 / 加载状态 */
export const chatState = reactive({
  /** 会话列表(按最后更新时间倒序) */
  chats: [],
  /** 正在拉列表 */
  loading: false,
  /** 还有没有更早的会话 */
  hasMore: false,
  /** 下一页的游标 */
  nextCursor: '',
  /** 列表已经拉过一次了(避免路由来回切时重复拉) */
  loaded: false,
  /** 拉列表的当口又有人要求「重新拉」→ 等这次拉完补一次 */
  pendingReset: false,
})

/** 模型选择(全局设置,侧边栏底部改) */
export const modelState = reactive({
  /** 后端可选的模型清单 */
  models: [],
  /** 当前选的模型 code;空字符串 = 用后端配置的默认模型 */
  code: '',
  /** 当前是否联网搜索 */
  webSearch: false,
  /** 模型清单拉过了 */
  loaded: false,
})

/**
 * 工具开关(全局)—— 输入框上面那排小标签
 *
 * <p>为什么从聊天页搬到这里:
 *   <ul>
 *     <li><b>首页也有输入框</b>,也要显示这排工具 —— 两处得是**同一份**选择
 *         (用户在首页勾了「天气」,跳到聊天页还是勾着的,反之亦然)。</li>
 *     <li>它本来就存在 localStorage 里,天生是跨页面的状态,
 *         放在页面组件里等于把全局状态塞进了一个会被卸载的壳。</li>
 *   </ul>
 */
export const toolState = reactive({
  /** 后端列出来的可用工具 */
  list: [],
  /** 勾选中的工具短名 */
  selected: [],
  /** 清单拿到了没 —— 没拿到(旧后端 / 网络不通)就不发 tools 参数,走后端默认 */
  loaded: false,
})

/** 工具勾选状态存在 localStorage 的哪个键下 */
const TOOLS_STORAGE_KEY = 'xiaoha-ai-robot.tools'

/**
 * 首页 → 聊天页 的消息交接
 *
 * <p>用完就清空(set to ''),不然下次进聊天页会**把上一条消息又发一遍**。
 */
export const handoff = reactive({
  /** 要在聊天页发出的消息 */
  message: '',
  /** 要在聊天页发出的图片(看图说话) */
  file: null,
  /** 那张图的预览地址(blob: URL)—— 聊天页拿去显示缩略图 */
  previewUrl: '',
})

/**
 * 一串连续的百分号转义(%E8%AE%B0 这种)→ 还原成文字
 *
 * <p>正常情况就是 decodeURIComponent 的效果;但后端把标题截断到 60 个字时,
 * 截断点很可能切在某个多字节字符中间("%E5%B9%B4%E8%B…" —— 末尾那个字只剩了 2 个字节),
 * 这时整体 decode 会抛 URIError,得逐段来。
 *
 * @param {string} run 连续的 %XX 转义
 * @returns {string} 还原后的文字;整段不是合法 UTF-8 时原样返回
 */
const decodeRun = (run) => {
  const bytes = []
  for (let i = 0; i < run.length; i += 3) {
    bytes.push(parseInt(run.slice(i + 1, i + 3), 16))
  }

  const text = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes))
  if (!text.includes('�')) return text

  // 有解不出来的字节:分两种情况
  //   a) 末尾是「半个字」(被截断)→ 丢掉这半个字,前面的照常显示
  //   b) 根本不是 UTF-8 → 整段原样保留(别把正常内容改坏)
  let i = bytes.length - 1
  while (i >= 0 && (bytes[i] & 0xc0) === 0x80) i-- // 跳过续字节
  if (i >= 0) {
    const lead = bytes[i]
    const need = lead >= 0xf0 ? 3 : lead >= 0xe0 ? 2 : lead >= 0xc0 ? 1 : 0
    const have = bytes.length - 1 - i
    if (need > 0 && have < need) return text.replace(/�+$/, '')
  }
  return run
}

/**
 * 把后端给的标题还原成人话
 *
 * <p>⚠️ 后端有部分数据是 **URL 编码**过的:
 *   "%E8%AE%B0%E4%BD%8F%EF%BC%9A…" 而不是「记住：…」。
 *   那些是历史遗留的脏数据(写入时多编码了一次),读出来就是一堆百分号。
 *
 * <p>⚠️ 而且后端会把标题截断到 60 个字 —— 截断点很可能切在某个多字节字符中间:
 *   "%E5%B9%B4%E8%B…" 里的 "%E8" 是个**残缺**的汉字(3 个字节只剩 1 个)。
 *   整串 decodeURIComponent 会抛 URIError,标题就全废了。
 *
 * <p>⚠️ 还有一条不能越的线:**含非 ASCII 字符的标题一律不碰**。
 *   「完成 50%BC 的任务」这种正常标题里也有 %XX,拿字节流去解会把中文全变成乱码。
 *   所以只有「整串都是可打印 ASCII」时才当它是编码过的
 *   (后端截断时补的省略号「…」不算 —— 它自己就是非 ASCII,得单独特判)。
 *
 * @param {string} summary
 * @returns {string}
 */
export const decodeSummary = (summary) => {
  if (!summary || typeof summary !== 'string') return ''
  // 不像百分号编码(比如正文里本来就有 %)→ 原样返回
  if (!/%[0-9A-Fa-f]{2}/.test(summary)) return summary
  // 含非 ASCII → 这是**正常**的标题(只是碰巧有百分号),别按字节流解
  // (省略号是后端截断时补的,放行)
  if (!/^[\x20-\x7e…]*$/.test(summary)) return summary

  try {
    return decodeURIComponent(summary)
  } catch {
    // 编码被截断在某个多字节字符中间 → 逐段还原,末尾残缺的那个字丢掉
    return summary
      .replace(/(?:%[0-9A-Fa-f]{2})+/g, decodeRun)
      // 末尾那个还原不出字的残缺转义("%B…")→ 去掉
      .replace(/%[0-9A-Fa-f](?![0-9A-Fa-f])(?=…|$)/g, '')
      // 截断留下的替换字符(在省略号前面)也一并清掉
      .replace(/�+(?=…|$)/g, '')
  }
}

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
 * 按「今天 / 昨天 / 7 天内 / 更早」分组
 *
 * <p>侧边栏全平铺的话,会话一多就找不到刚才聊的那个了。
 * 按时间分组是聊天产品最常见的做法。
 *
 * @returns {Array<{label: string, items: Array<object>}>}
 */
export const groupedChats = computed(() => {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const dayMs = 24 * 60 * 60 * 1000

  const buckets = [
    { label: '今天', items: [] },
    { label: '昨天', items: [] },
    { label: '更早', items: [] },
  ]

  chatState.chats.forEach((chat) => {
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
export const loadChats = async ({ reset = false } = {}) => {
  // 正在拉:别并发拉两次,但「要重来」的请求得记下来,等这次拉完再补一次。
  // (发完消息会刷新列表,路由变了也会刷新 —— 两者很容易撞在一起)
  if (chatState.loading) {
    if (reset) chatState.pendingReset = true
    return
  }
  if (!reset && chatState.hasMore && !chatState.nextCursor) return

  chatState.loading = true
  try {
    const res = await conversationApi.list({
      size: 20,
      cursor: reset ? '' : chatState.nextCursor,
    })
    if (reset) {
      chatState.chats = res.items
    } else {
      // 游标翻页可能有重复(后端按 updateTime 排序,翻页期间又聊了新消息),
      // 按 uuid 去重再拼
      const seen = new Set(chatState.chats.map((c) => c.uuid))
      chatState.chats = [
        ...chatState.chats,
        ...res.items.filter((c) => c.uuid && !seen.has(c.uuid)),
      ]
    }
    chatState.hasMore = res.hasMore
    chatState.nextCursor = res.nextCursor
    chatState.loaded = true
  } catch (e) {
    console.error('拉会话列表失败: ', e)
  } finally {
    chatState.loading = false
    // 刚才有人要求「重新拉」→ 补一次
    if (chatState.pendingReset) {
      chatState.pendingReset = false
      loadChats({ reset: true })
    }
  }
}

/**
 * 拉模型清单
 *
 * @returns {Promise<void>}
 */
export const loadModels = async () => {
  if (modelState.loaded) return
  const list = await modelApi.list()
  modelState.models = list
  modelState.loaded = true
}

/**
 * 选模型
 *
 * <p>⚠️ 这里**不碰** webSearch:联网搜索是用户自己的偏好,
 *    和「用哪个模型」是两件事。
 *    以前选模型的时候顺手把联网搜索对齐到模型的能力,结果用户勾上的联网搜索
 *    被模型切换悄悄改掉 —— 换个不支持联网的模型,搜索就被关了,
 *    用户会以为是自己关的,更糟的是「我明明开着联网」却没搜。
 *
 * @param {string} code 模型 code;空 = 用后端默认
 */
export const selectModel = (code) => {
  modelState.code = code || ''
}

/**
 * 本次请求「实际」要不要联网搜索
 *
 * <p>⚠️ 用户开着、但选的模型不支持 → **不能**发 networkSearch=true:
 *    后端对这种情况直接 400(它不静默降级 —— 照常回答只是没搜,
 *    会让人以为「搜过了」,拿到的却是模型的过时知识,比报错更难发现)。
 *    所以这里降级成 false,并把原因带回去,由界面告诉用户「本次没有联网」。
 *
 * <p>⚠️ code 为空(用后端配的默认模型)时,前端**不知道**它支不支持 ——
 *    后端没把「哪个是默认」标出来。这种情况按「支持」处理:
 *    真不支持的话,后端会返回一句人话错误(「请换一个支持联网搜索的模型…」)。
 *
 * @returns {{enabled: boolean, reason: string}} reason 非空 = 被降级了,得告诉用户
 */
export const resolveWebSearch = () => {
  if (!modelState.webSearch) return { enabled: false, reason: '' }
  const model = modelState.models.find((m) => m.code === modelState.code)
  if (model && model.webSearch === false) {
    return { enabled: false, reason: `「${model.name}」不支持联网搜索,本次没有联网` }
  }
  return { enabled: true, reason: '' }
}

/**
 * 本次请求要带的 tools 参数
 *
 * <p>⚠️ 「一个都没勾」和「不传」是两回事:
 * 不传 = 用后端配置的默认工具(datetime);一个都没勾 = 明确全部关掉(后端认 none)。
 * 混起来的话,用户把工具全关了却还在用默认工具,就会觉得「关不掉」。
 */
export const toolsParam = computed(() => {
  if (!toolState.loaded) return ''
  return toolState.selected.length ? toolState.selected.join(',') : 'none'
})

/**
 * 拉工具清单:优先用上次勾选的,没有才用后端说的「默认开启」
 *
 * <p>清单和默认勾选状态**都来自后端**,前端不写死:
 * 后端加工具 → 前端自动多一个按钮,前端零改动。
 *
 * <p>⚠️ 整个应用只调一次(Layout 挂载时调)。再调一次会用 localStorage
 * 里的旧值**覆盖**用户刚刚在页面上做的勾选 —— 那就白勾了。
 */
export const loadTools = async () => {
  // 已经拉到了就别再拉:第二次会用 localStorage 里的旧值
  // **覆盖**用户刚刚在页面上做的勾选 —— 那就白勾了。
  if (toolState.loaded) return
  const list = await chatApi.tools()
  toolState.list = list

  let saved = null
  try {
    saved = JSON.parse(localStorage.getItem(TOOLS_STORAGE_KEY) || 'null')
  } catch {
    saved = null // 存坏了(手动改过)→ 当作没有,走默认
  }
  const known = new Set(list.filter((t) => t.available !== false).map((t) => t.name))
  if (Array.isArray(saved)) {
    // 只保留后端还认识的工具(后端升级后可能删了某个工具)
    // ⚠️ 还要滤掉「后端说不可用」的:它们没发给模型,勾上会让后端直接 400
    toolState.selected = saved.filter((n) => known.has(n))
  } else {
    toolState.selected = list
      .filter((t) => t.available !== false && t.defaultEnabled)
      .map((t) => t.name)
  }
  toolState.loaded = list.length > 0
}

/**
 * 勾/取消一个工具(并记住)
 *
 * <p>⚠️ 勾选状态存 localStorage —— **刷新/换标签页都不能丢**:
 * 工具没勾上 = 模型压根看不到这个工具,会直接说
 * 「我没有联网搜索 GitHub 的能力」然后凭记忆瞎答。
 */
export const toggleTool = (name) => {
  // 不可用的工具不让勾 —— 后端没把它发给模型,勾了只会让请求 400
  const tool = toolState.list.find((t) => t.name === name)
  if (tool && tool.available === false) return
  const i = toolState.selected.indexOf(name)
  if (i === -1) {
    toolState.selected = [...toolState.selected, name]
  } else {
    toolState.selected = toolState.selected.filter((n) => n !== name)
  }
  try {
    localStorage.setItem(TOOLS_STORAGE_KEY, JSON.stringify(toolState.selected))
  } catch {
    // 隐私模式下 localStorage 可能不可写 → 忽略,只是这次不记住而已
  }
}

/**
 * 删掉一个会话(本地列表也一起删)
 *
 * @param {string} uuid
 * @returns {Promise<boolean>}
 */
export const removeChat = async (uuid) => {
  const ok = await conversationApi.remove({ uuid })
  if (ok) {
    chatState.chats = chatState.chats.filter((c) => c.uuid !== uuid)
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
export const renameChat = async (id, summary) => {
  const res = await conversationApi.rename({ id, summary })
  chatState.chats = chatState.chats.map((c) =>
    c.id === id ? { ...c, summary: res.summary } : c
  )
  return res.summary
}

/**
 * 生成一个会话 uuid(后端建会话失败时的兜底)
 *
 * <p>后端 POST /chat/new 会给一个真正的 uuid;
 * 万一那一步挂了,前端自己造一个也能发 —— 后端按 chatId 存消息,
 * 不校验 uuid 是不是它自己发的。
 *
 * @returns {string}
 */
export const genUuid = () =>
  globalThis.crypto?.randomUUID?.() ||
  `web-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
