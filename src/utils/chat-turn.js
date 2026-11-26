/**
 * 聊天轮次相关的纯函数。
 *
 * 单独拆出来是因为这里有一条**很容易悄悄坏掉**的规则：
 * 只有「最后一条回答」能点重新生成。弄错了不会报错，
 * 只会让后端记忆文件被写脏（同一个问题问两遍），很难从界面上看出来。
 */

/**
 * 最后一条「有对应提问」的回答的 id —— 只有它能重新生成。
 *
 * ⚠️ 为什么只有最后一条能重新生成：
 *   后端的 `DELETE /chat/{uuid}/last-turn` 只会回滚**最后一轮**，
 *   它没有「按轮次回滚」的能力。如果允许重新生成中间那条回答：
 *     记忆 [u1,a1,u2,a2]，用户点第 1 轮的「重新生成」
 *     → 后端删掉的是最后一轮 → 记忆变成 [u1,a1]
 *     → 前端重发第 1 轮的提问 → 记忆变成 [u1,a1,u1,a1_new]
 *   结果是同一个问题问了两遍（模型会当成在追问），而且最后一轮凭空消失，
 *   但它的气泡还留在页面上 —— 前端和后端对不上。
 *
 *   问候语（turn = 0）不算 —— 它没有对应的提问。
 *
 * @param {Array<{id: string, role: string, turn?: number, kind?: string}>} chatList 聊天记录
 * @param {string} [kind] 只看这一类消息（'text' 文字对话 / 'vision' 看图说话）。
 *   两种对话的后端语义不同：文字对话要回滚记忆，看图说话是无状态的（不用回滚），
 *   所以「最后一条」得按类型分别算。
 * @returns {string} 可重新生成那条消息的 id；没有则返回空字符串
 */
export const lastRegenerableId = (chatList, kind = 'text') => {
  if (!Array.isArray(chatList)) return ''
  for (let i = chatList.length - 1; i >= 0; i--) {
    const c = chatList[i]
    if (!c || c.role !== 'assistant') continue
    if ((c.kind ?? 'text') !== kind) continue
    if ((c.turn ?? 0) > 0) return c.id
  }
  return ''
}

/**
 * 这条回答是本次会话的第几轮（从 1 开始；问候语是 0）。
 *
 * 后端的记忆文件是 [u1,a1,u2,a2,…] 这种交替结构，
 * 「第 k 轮的回答」对应记忆里第 2k-1 条 —— 拿它当反馈的定位标识。
 *
 * ⚠️ 文字对话和看图说话**分别计数**：
 *   文字对话的轮次要和后端记忆里的顺序对得上，所以只数文字消息；
 *   看图说话是独立的无状态问答，用自己的轮次号 + 自己的 chatId 上报反馈，
 *   免得和文字对话的轮次号撞车（撞了的话，反馈就指错回答了）。
 *
 * @param {Array<{id: string, role: string, turn?: number}>} chatList 聊天记录
 * @param {string} messageId 消息 id
 * @returns {number} 轮次；找不到返回 0
 */
export const turnIndexOf = (chatList, messageId) => {
  if (!Array.isArray(chatList)) return 0
  const msg = chatList.find((c) => c.id === messageId)
  return msg?.turn ?? 0
}

/**
 * 窗口前面还压着几轮 —— 也就是「窗口里最早那条之前有多少轮」
 *
 * <p>历史消息是**分页加载**的：打开会话先拿最新的一页，用户往上一滑才加载更早的。
 * 而「第 k 轮」必须是从**会话开头**数起的（反馈上报拿 turnIndex 当定位标识），
 * 所以光数窗口里有几条提问是不够的 —— 还得知道窗口前面压着多少轮。
 *
 * <p>那个数 = 后端报的总轮数 - 窗口里已经归档的部分。
 *
 * @param {number} totalTurns       这个会话一共多少轮（后端数的；0 = 不知道）
 * @param {number} archivedInWindow 窗口里已归档的提问条数
 * @returns {number} 偏移量；总轮数不知道时是 0（轮次号退化成相对值）
 */
export const baseTurnOf = (totalTurns, archivedInWindow) => {
  if (!totalTurns) return 0
  return Math.max(0, totalTurns - archivedInWindow)
}

/**
 * 给窗口里的所有消息编号「第几轮」
 *
 * <p>轮次的定义：从**会话开头**数起的提问条数 ——
 *    第 k 条提问 + 第 k 条回答 = 第 k 轮（回答的轮次 = 它上面那条提问的轮次）。
 *
 * <p>⚠️ 为什么要整个窗口一起数，而不是每条消息各自算：
 *    窗口是分页加载出来的，会变（往上翻一页、或者本地发了一条新的），
 *    各自算的话前后对不上。统一从 baseTurn 往后数才对得上。
 *
 * <p>⚠️ 翻页的边界可能把「提问」和「回答」切在两页里：
 *    这时那条回答的提问还在没加载的那页，轮次照样对得上
 *    （baseTurn 已经是那页之前压着的轮次数）。
 *
 * <p>⚠️ 看图说话**单独编号**：它是无状态的，不走后端的聊天记忆，
 *    反馈上报时用的是自己的 chatId，轮次号也各数各的。
 *
 * @param {Array<{role: string, kind?: string}>} list 聊天记录（就地改 turn 字段）
 * @param {number} [baseTurn] 窗口前面压着几轮
 * @returns {Array<object>} 传进来的那份 list
 */
export const assignTurns = (list, baseTurn = 0) => {
  if (!Array.isArray(list)) return list
  let textTurn = baseTurn
  let visionTurn = 0
  for (const c of list) {
    if (!c) continue
    if ((c.kind ?? 'text') === 'vision') {
      if (c.role === 'user') visionTurn += 1
      c.turn = visionTurn
    } else if (c.role === 'user') {
      textTurn += 1
      c.turn = textTurn
    } else {
      // 回答的轮次 = 它上面那条提问的轮次（此刻数到的提问数就是它）；
      // 问候语前面没有提问，baseTurn=0 时它的轮次也是 0
      c.turn = textTurn
    }
  }
  return list
}

/**
 * 数一页后端消息里有几条提问（= 几轮）
 *
 * @param {Array<{role: string}>} list 后端的消息数组
 * @returns {number}
 */
export const countUserTurns = (list) =>
  (Array.isArray(list) ? list : []).filter((m) => m && m.role === 'user').length
