/**
 * 首页 → 聊天页 的消息交接
 *
 * <p>用户在首页输入框打了一句话(或带一张图),点发送后要跳到聊天页并把它发出去。
 *    跨路由传东西就那么几条路:
 *
 * <table>
 *   <tr><td>URL 参数</td><td>❌ 有长度上限,中文还要转义 —— 长消息会被截断</td></tr>
 *   <tr><td>组件 props</td><td>❌ 跨路由了,拿不到</td></tr>
 *   <tr><td>路由 state</td><td>⚠️ 见下面「为什么没用它」</td></tr>
 *   <tr><td>内存 + sessionStorage</td><td>✅ 这里用的就是这条</td></tr>
 * </table>
 *
 * <p>⚠️ 为什么没用「路由 state」(history.state)——
 *    教程里教的那个写法看着最优雅,但有两个绕不开的坑:
 *
 * <p><b>① 同一条消息会被发两遍。</b>
 *    state 存在 history 里,浏览器刷新会把它恢复出来,点「后退」也会回到那条记录 ——
 *    而 state 里的 firstMessage 是「取走即失效」才对的。
 *    教程的代码只读不删,于是用户每刷新一次这条会话,那条消息就**再发一遍**
 *    (后端记忆里会多出一次同样的提问)。要修就得在取走后
 *    history.replaceState 把 state 抹掉 —— 那还不如一开始就别用 state。
 *
 * <p><b>② 用侧边栏重新进同一个会话时,消息会丢。</b>
 *    state 挂在「那一条历史记录」上:用户发完消息马上点侧边栏切到别的会话,
 *    消息还留在原来那条记录里;等他再点侧边栏回到这个会话时,
 *    那是**新的一条历史记录**,上面没有那条消息 —— 消息就这么没了。
 *    (只有用浏览器「后退」回去才能拿回来。)
 *
 * <p>所以这里用「**一个槽位**」:
 *    · 槽位认 chatId —— 消息只会发给建它的那个会话,不可能发错地方;
 *    · 槽位随时能读到 —— 不管用户怎么导航(切会话、点后退、刷新),消息都还在;
 *    · 文字额外在 sessionStorage 里存一份 —— 刷新页面也不丢
 *      (内存里的一切刷新即没,用户手快按一下 F5,打的字就白打了)。
 *      图片存不了(File 和 blob: URL 都过不了 JSON),图片只在内存里。
 *
 * <p>⚠️ 槽位**不是**「取走就清空」,而是「消息出现在会话历史里才清空」:
 *    清空的时机交给后端的历史说话,而不是本地的标记 ——
 *    理由见 ChatPage.vue 里 consumeHandoff 的说明(页面在交接途中被刷新时,
 *    本地标记会把消息「清掉但没发出去」,用户的消息就丢了)。
 */

/** 槽位:一次只交接一条消息 */
const pending = {
  /** 这条消息是给哪个会话的 —— 不认会话的话,消息会发到别的会话里去 */
  chatId: '',
  /** 要发的文字 */
  message: '',
  /** 要发的图片(压缩好的 File) */
  file: null,
  /** 图片的预览地址(blob: URL) */
  previewUrl: '',
}

/** 文字备份的存储键(刷新页面也不丢的那一份) */
const STORAGE_KEY = 'xiaoha-ai-robot.handoff'

/**
 * 读备份
 *
 * @returns {{chatId: string, message: string}|null}
 */
const readStored = () => {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    return data && typeof data === 'object' ? data : null
  } catch {
    // 存坏了(手动改过)或者隐私模式下读不了 → 当作没有
    return null
  }
}

/**
 * 写备份(传 null = 清掉)
 *
 * <p>⚠️ 隐私模式下 sessionStorage 可能不可写 —— 忽略就行,
 *    只是「刷新不丢」这个保证没了,别的都不受影响。
 */
const writeStored = (data) => {
  try {
    if (data) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    else sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // 写不了就算了
  }
}

/**
 * 首页点发送:建好会话后跳过去,并把要发的消息带上
 *
 * <p>跳转用的是**命名路由**:路径以后改了(比如 /chat/:uuid → /c/:id),
 *    这里不用跟着改 —— 写死的 `/chat/${uuid}` 会静悄悄地跳错地方。
 *
 * @param {import('vue-router').Router} router
 * @param {object} params
 * @param {string} params.uuid           目标会话的 uuid
 * @param {string} [params.message]      要发的文字(可以为空)
 * @param {File|null} [params.file]      要带的图片(可以为空)
 * @param {string} [params.previewUrl]   图片的预览地址(blob: URL)
 */
export const sendToChat = (router, { uuid, message = '', file = null, previewUrl = '' }) => {
  if (file) {
    // 上一次交接的图片没人要了 → 把它的 blob 地址收掉
    // (首页那边已经 detach 了,不会再回收它 —— 不收就是泄漏到页面关闭)
    if (pending.previewUrl && pending.previewUrl !== previewUrl) {
      URL.revokeObjectURL(pending.previewUrl)
    }
    pending.file = file
    pending.previewUrl = previewUrl
  }
  pending.chatId = uuid
  pending.message = message

  // 文字在 sessionStorage 里留一份 —— 刷新页面也不丢
  writeStored({ chatId: uuid, message })

  router.push({
    name: 'chat',
    params: { uuid },
  })
}

/**
 * 看一眼交接的内容(**不清空**)
 *
 * <p>⚠️ 对不上会话就返回 null:消息不会丢,它还在槽子里,
 *    等用户回到那个会话时再发出去 ——
 *    绝不会发到别的会话里去(后端记忆也就不会串)。
 *
 * @param {string} uuid 当前会话的 uuid
 * @returns {{message: string, file: File|null, previewUrl: string}|null}
 */
export const peekHandoff = (uuid) => {
  let chatId = pending.chatId
  let message = pending.message

  if (!message) {
    // 内存里没有 → 可能刚刷新过,从备份里捞
    const stored = readStored()
    if (stored && stored.chatId === uuid && stored.message) {
      chatId = stored.chatId
      message = stored.message
    }
  }

  if (!chatId || chatId !== uuid) return null
  if (!message && !pending.file) return null

  return {
    message,
    file: pending.file,
    previewUrl: pending.previewUrl,
  }
}

/**
 * 清掉交接的内容(消息已经出现在会话历史里了 —— 交接完成)
 */
export const clearHandoff = () => {
  pending.chatId = ''
  pending.message = ''
  pending.file = null
  pending.previewUrl = ''
  writeStored(null)
}
