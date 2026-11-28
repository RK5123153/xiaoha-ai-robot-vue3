/**
 * 思考链的攒法 —— 主聊天页和智能客服页共用一份
 *
 * <p>为什么抽出来:两个页面都要「把后端流过来的思考链片段攒成一条完整的链,
 *    太长了就从**前面**截掉」—— 规则一样的事抄两份,改一处就漏一处
 *    (漏的那份会变成「思考链越攒越长,气泡越来越重」)。
 */

/**
 * 思考链最多留多长(字)
 *
 * <p>⚠️ 思考链可能很长(实测一两千字,推理模型给几万个字也不稀奇),
 *    而它是**要显示给用户看的** —— 截掉的那部分用户就再也看不到了
 *    (后端归档的是全文,刷新页面能看到完整的,这就对不上了)。
 *
 * <p>所以这个上限不是为了「省气泡」,是为了给 DOM 和 Markdown 解析兜个底:
 *    面板本身限高 320px 自己滚,渲染出来的节点数也是有限的,
 *    两万个字足够覆盖绝大多数推理链,真超了就从**前面**截(结尾那几段才是结论)。
 */
export const THINKING_MAX = 20000

/**
 * 攒思考链
 *
 * @param {string} current 已有的思考链
 * @param {string} add     新来的一段
 * @returns {string} 新的思考链
 */
export const appendThinking = (current, add) => {
  const next = (current || '') + (add || '')
  return next.length > THINKING_MAX ? next.slice(next.length - THINKING_MAX) : next
}

/**
 * 这一轮到了哪一步(思考链面板用)
 *
 * <p>⚠️ 两个页面(主聊天页 / 智能客服页)的消息对象形状一样,
 *    这里算一处 —— 各写各的话迟早写岔,
 *    岔了就会出现「正文都出来了,面板还在转圈」这种自相矛盾的样子。
 *
 * @param {object} chat 消息对象(有 pending / done 两个标志)
 * @returns {'thinking'|'answering'|'done'}
 *   thinking  —— 模型还在想(正文一个字都没出来)
 *   answering —— 正文已经开始输出
 *   done      —— 这一轮结束了
 */
export const phaseOf = (chat) => {
  if (!chat) return 'done'
  if (chat.done) return 'done'
  return chat.pending ? 'thinking' : 'answering'
}
