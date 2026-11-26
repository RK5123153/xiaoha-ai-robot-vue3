import { createRouter, createWebHashHistory } from 'vue-router'
import Layout from '@/layouts/Layout.vue'

// 统一在这里声明所有路由
//
// 嵌套路由:Layout 是「壳」(左边栏 + 主内容区),真正的页面放在它的 children 里。
// 这样切页面时侧边栏不会跟着卸载 —— 聊天记录列表、滚动位置、模型选择都还在。
//
// ⚠️ 跳转一律用**命名路由**(router.push({ name: 'chat', params: { uuid } })),
//    别写死路径 —— 路径改了(比如 /chat/:uuid → /c/:id),写死的地方会静悄悄地跳错。
//
// ⚠️ 首页 → 聊天页要交接的那条消息,不走 URL、也不走路由 state,
//    走 utils/handoff.js(一个认会话的槽位 + sessionStorage 备份)。
const routes = [
    {
        path: '/', // 路由地址
        component: Layout, // 布局组件(壳)
        children: [
            {
                path: '', // 空路径 = 首页(/)
                name: 'home',
                component: () => import('@/views/Index.vue'), // 欢迎页 / 新对话
                meta: {
                    title: '小哈 AI 助手'
                }
            },
            {
                path: 'chat/:uuid', // /chat/<会话 uuid>
                name: 'chat',
                component: () => import('@/views/ChatPage.vue'), // 对话聊天页
                meta: {
                    title: '对话'
                }
            }
        ]
    },
    // 认不出来的地址一律回首页(别给用户一个白屏)
    {
        path: '/:pathMatch(.*)*',
        redirect: '/'
    }
]

// 创建路由
const router = createRouter({
    // 指定路由模式，hash 模式指的是 URL 的路径是通过 hash 符号（#）进行标识
    history: createWebHashHistory(),
    // routes: routes 的缩写
    routes,
})

// 改一下浏览器标签页的标题
// (每个路由的 meta.title 就是它想要的标题)
router.afterEach((to) => {
    const title = to.meta?.title as string | undefined
    document.title = title ? `${title} - 小哈 AI` : '小哈 AI'
})

// ES6 模块导出语句，它用于将 router 对象导出，以便其他文件可以导入和使用这个对象
export default router
