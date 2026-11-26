import './assets/main.css'

import { createApp } from 'vue'
import App from './App.vue'
// 这里起别名:页面里已经有叫 message 的变量(输入框的草稿)
import { message as antMessage } from 'ant-design-vue'
// 全局状态管理(Pinia)—— 模型选择 / 联网搜索 / 工具开关 这些跨页面共享的状态
import { createPinia } from 'pinia'
// 持久化插件:把「用户的选择」(选了哪个模型、开没开联网)存进 localStorage
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'

// 导入路由
import router from './router'
const app = createApp(App)

/**
 * Pinia
 *
 * <p>⚠️ 插件必须在 app.use(pinia) **之前**挂上:
 *    插件是在 store **第一次被创建**时跑的,那时它已经把 state 从
 *    localStorage 读回来写进 store 了 —— 挂晚了,头一个 store 读不到存着的值。
 */
const pinia = createPinia()
pinia.use(piniaPluginPersistedstate)
app.use(pinia)

// 应用路由
app.use(router)

/**
 * 全局错误兜底
 *
 * <p>没有它的时候,页面上任何一处渲染出错都是**白屏** ——
 *    用户只看到一个空页面,连「出错了」都不知道,更别说去开控制台看堆栈。
 *
 * <p>Vue 会把生命周期钩子、watch、渲染函数、**事件处理函数**里的错误
 *    都交给这个钩子(含 async 事件处理函数的 Promise 拒绝),
 *    所以大部分「点一下就炸」的错误都能在这里变成一句人话。
 */
app.config.errorHandler = (err, _instance, info) => {
  console.error('页面出错了:', err, info)
  antMessage.error('页面出了点问题，刷新一下试试')
}

/**
 * 兜住「飘在 async 函数里」的 Promise 拒绝
 *
 * <p>Vue 只接管它自己发起的 Promise;setTimeout / 原生事件回调里
 *    冒出来的拒绝它管不着 —— 那就会变成控制台里一句
 *    「Uncaught (in promise)」,界面上一点提示都没有。
 */
window.addEventListener('unhandledrejection', (e) => {
  console.error('没被接住的 Promise 拒绝:', e.reason)
  antMessage.error('页面出了点问题，刷新一下试试')
})

app.mount('#app')
