<template>
  <!--
    antd 的全局配置:所有 <a-*> 组件的样式都走这里的 token。
    ⚠️ 别用 antd 默认的蓝(#1677ff)—— 这个站的品牌色是 #4d6bfe,
    不统一的话同一个页面里会同时出现两种蓝。
    主题放这儿而不是每个组件里各写各的:以后引入 Dropdown / Modal 时自动就是这个色。
  -->
  <a-config-provider :theme="antdTheme" :locale="zhCN">
    <router-view />
  </a-config-provider>
</template>

<script setup>
// 这里给 message 起别名:两个页面里已经有叫 message 的变量(输入框的草稿)
import { ConfigProvider, message as antMessage } from 'ant-design-vue'
// antd 的中文语言包 —— 默认是英文的:分页条是 "items per page"、
// 空列表是 "No Data"、确认框的按钮是 "OK / Cancel"
import zhCN from 'ant-design-vue/es/locale/zh_CN'

/**
 * antd 组件的全局主题
 *
 * <p>token 和 assets/base.css 对齐(字体栈、字号、圆角),
 * 免得 antd 组件和手写的 Tailwind 组件摆在一起时看着像两个产品。
 */
const antdTheme = {
  token: {
    colorPrimary: '#4d6bfe',
    colorLink: '#4d6bfe',
    // ⚠️ 提示条(message)里的小图标用的是 colorInfo,不是 colorPrimary ——
    //    不单独设的话它会是 antd 默认的蓝,和站点不是一个色
    colorInfo: '#4d6bfe',
    borderRadius: 8,
    fontSize: 14,
    fontFamily:
      "Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'PingFang SC', 'Microsoft YaHei', sans-serif",
  },
  components: {
    Tooltip: {
      // antd 默认的 rgba(0,0,0,0.85) 偏纯黑,换成偏蓝黑的深灰,和站点其它深色气泡一致
      colorBgSpotlight: 'rgba(17, 24, 39, 0.92)',
    },
  },
}

/**
 * 把同一份主题也设成「全局的」
 *
 * <p>为什么模板里已经有 <a-config-provider> 了还要再来一遍:
 *    **静态 API**(message / notification 这些 `import { message } from 'ant-design-vue'`
 *    直接调的那种)不读组件树上的 ConfigProvider,它们只认这份全局配置。
 *    不设的话,轻提示里的小图标会是 antd 默认的蓝,和站点其它地方不是一个色。
 */
ConfigProvider.config({ theme: antdTheme })

/**
 * antd 轻提示(message)的全局行为
 *
 * <p>maxCount: 1 —— 新的提示把旧的顶掉,不要叠一串。
 * <p>duration: 3 秒 —— 和原来手写的那个一致。
 */
antMessage.config({ maxCount: 1, duration: 3 })

/**
 * 把语言包也设成「全局的」
 *
 * <p>和主题一个道理:静态 API(Modal.confirm 这种直接调的)不读组件树上的
 * ConfigProvider,只认这份全局配置 —— 不设的话,静态弹窗的按钮还是英文的。
 */
ConfigProvider.config({ theme: antdTheme, locale: zhCN })
</script>
