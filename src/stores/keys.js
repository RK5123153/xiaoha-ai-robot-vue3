/**
 * 状态存到 localStorage 的键名
 *
 * <p>集中放一处的原因:store 里用它读写,**跨标签页同步**那里也要用同一个字符串 ——
 *    两边各写一份的话,改了一处忘了另一处,同步就静悄悄地不生效了
 *    (不报错,只是「另一个标签页改了设置,这边没反应」,最难查的那种问题)。
 */
export const STORAGE_KEYS = {
  /** 模型选择 + 联网搜索开关 */
  model: 'xiaoha-ai-robot.model',
  /** 工具勾选 */
  tools: 'xiaoha-ai-robot.tools',
  /** 每个会话的输入框草稿 */
  drafts: 'xiaoha-ai-robot.drafts',
}
