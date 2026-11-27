/**
 * 智能客服的对话 —— 一份「切页面也不会丢」的对话记录
 *
 * <p>为什么放在 store 里、而不是页面自己拿个 ref 存:
 *    客服问答是**无状态**的(后端不接聊天记忆、也不归档),但「无状态」不等于
 *    「用户离开这一页,刚才问的那句和答的那句就该消失」——
 *    用户问完切去主对话页、再切回来发现刚才那轮没了,会以为是自己没问成。
 *
 * <p>⚠️ <b>不持久化</b>:刷新页面这段对话就没了。
 *    存进 localStorage 的话,刷新后看到的还是**上次的答案** ——
 *    知识库更新了、答案变了,用户分不清「这是刚才问的」还是「这是新的」。
 *    宁可老老实实:刷新就是新的一轮。
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'

/** 欢迎语 —— 客服页的第一屏 */
export const SERVICE_GREETING =
  '你好呀！我是「犬小哈项目实战专栏」的 AI 智能客服，基于 Spring AI 开发，欢迎向我咨询项目相关问题哈 😁'

/**
 * 造一条欢迎语消息
 *
 * <p>每次都新建一个对象:欢迎语是消息数组里的第一条,
 *    「清空对话」之后要的是一条**全新**的,不是把旧的改回去
 *    (不然 Vue 那边可能因为对象没变而不重新渲染)。
 *
 * @returns {object}
 */
const greetingMessage = () => ({
  id: 'greeting',
  role: 'assistant',
  content: SERVICE_GREETING,
  done: true,
})

export const useServiceStore = defineStore('service', () => {
  /** 客服对话的消息(第一条是欢迎语) */
  const messages = ref([greetingMessage()])

  /**
   * 清空对话,重新开始
   *
   * <p>⚠️ 只清**这一段对话**,不动主聊天的会话列表 ——
   *    客服问答压根不写进会话表,两边没有交集。
   */
  const reset = () => {
    messages.value = [greetingMessage()]
  }

  return {
    messages,
    reset,
  }
})
