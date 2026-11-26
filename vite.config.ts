import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import vueDevTools from "vite-plugin-vue-devtools";
import tailwindcss from "@tailwindcss/vite";
import Components from "unplugin-vue-components/vite";
import { AntDesignVueResolver } from "unplugin-vue-components/resolvers";

// https://vite.dev/config/
export default defineConfig({
  server: {
    proxy: {
      // 前端只认同源的 /api(见 src/api/base.js),转发到后端。
      //
      // ⚠️ 为什么走代理而不是把后端地址写死在前端:
      //   · 写死的话,打包出来的东西永远指向 localhost —— 部署到任何域名上,
      //     请求都跑到「访客自己电脑的 8080 端口」去,页面直接不可用。
      //   · 走代理的话前后端同源,不用处理跨域;生产环境用 nginx 做同样的转发就行。
      //
      // ⚠️ rewrite 要把 /api 前缀**去掉**:后端的路径是 /chat/**、/v13/**,
      //   前缀是前端自己加的,后端并不认识。
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/api/, ''),
      },
    },
  },
  plugins: [
    vue(),
    vueDevTools(),
    tailwindcss(),
    Components({
      resolvers: [
        AntDesignVueResolver({
          importStyle: false, // css in js
          // 图标也走 antd 的官方包:<EllipsisOutlined /> 这种直接写就能用,
          // 不用自己画 SVG、也不用维护一份 sprite
          resolveIcons: true,
        }),
      ],
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
