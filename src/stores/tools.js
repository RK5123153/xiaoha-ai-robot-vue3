/**
 * 工具开关 —— 输入框上面那排小标签(datetime / amap / github…)
 *
 * <p>为什么它住在一个「全局 store」里:
 * <ul>
 *   <li><b>首页也有输入框</b>,也要显示这排工具 —— 两处得是**同一份**选择
 *       (用户在首页勾了「天气」,跳到聊天页还是勾着的,反之亦然)。</li>
 *   <li>它本来就是跨页面的状态,天生就该住在页面组件之外。</li>
 * </ul>
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { toolApi } from '@/api/chat.js'
import { safeStorage } from '@/utils/storage.js'
import { STORAGE_KEYS } from './keys.js'

export const useToolStore = defineStore(
  'tools',
  () => {
    /** 后端列出来的可用工具 */
    const list = ref([])
    /** 勾选中的工具短名 */
    const selected = ref([])
    /**
     * 「用户自己动过勾选」吗
     *
     * <p>⚠️ 光看 selected 分不清两种情况:
     * <ul>
     *   <li>用户明确把工具**全关了** → selected = []</li>
     *   <li>用户还没动过(第一次来) → 也可能是 []</li>
     * </ul>
     * 持久化读回来的时候这两种长得一模一样(都是 [])——
     * 分不清的话,就会把用户明确关掉的工具又给勾回默认的那些,
     * 用户会以为「关不掉」。
     *
     * <p>所以用一个单独的标记记着「这是用户的选择,不是默认值」。
     */
    const decided = ref(false)
    /** 清单拿到了没 —— 没拿到(旧后端 / 网络不通)就不发 tools 参数,走后端默认 */
    const loaded = ref(false)

    /**
     * 本次请求要带的 tools 参数
     *
     * <p>⚠️ 「一个都没勾」和「不传」是两回事:
     * 不传 = 用后端配置的默认工具(datetime);一个都没勾 = 明确全部关掉(后端认 none)。
     * 混起来的话,用户把工具全关了却还在用默认工具,就会觉得「关不掉」。
     */
    const toolsParam = computed(() => {
      if (!loaded.value) return ''
      return selected.value.length ? selected.value.join(',') : 'none'
    })

    /**
     * 把勾选里「后端已经不认识 / 不能用」的工具去掉
     *
     * <p>⚠️ 不可用的工具(比如 GitHub 没配 PAT)后端根本没发给模型,
     *    还带着它发请求 → 后端直接 400。
     *
     * <p>⚠️ 清单还没拉到的时候**不动** —— 那时候什么都不知道,
     *    滤一遍等于把用户的勾选全清空。
     */
    const reconcileSelection = () => {
      if (!list.value.length) return
      const known = new Set(
        list.value.filter((t) => t.available !== false).map((t) => t.name)
      )
      const next = selected.value.filter((n) => known.has(n))
      if (next.length !== selected.value.length) selected.value = next
    }

    /**
     * 拉工具清单:优先用上次勾选的,没有才用后端说的「默认开启」
     *
     * <p>清单和默认勾选状态**都来自后端**,前端不写死:
     * 后端加工具 → 前端自动多一个按钮,前端零改动。
     *
     * <p>⚠️ 整个应用只调一次(Layout 挂载时调)。再调一次会用存着的旧值
     * **覆盖**用户刚刚在页面上做的勾选 —— 那就白勾了。
     */
    const loadTools = async () => {
      if (loaded.value) return
      const items = await toolApi.list()
      list.value = items

      if (!decided.value) {
        // 用户还没自己动过勾选 → 按后端说的「默认开启」来
        selected.value = items
          .filter((t) => t.available !== false && t.defaultEnabled)
          .map((t) => t.name)
      }
      reconcileSelection()
      loaded.value = items.length > 0
    }

    /**
     * 勾/取消一个工具(并记住)
     *
     * <p>⚠️ 勾选状态会被持久化 —— **刷新/换标签页都不能丢**:
     * 工具没勾上 = 模型压根看不到这个工具,会直接说
     * 「我没有联网搜索 GitHub 的能力」然后凭记忆瞎答。
     */
    const toggleTool = (name) => {
      // 不可用的工具不让勾 —— 后端没把它发给模型,勾了只会让请求 400
      const tool = list.value.find((t) => t.name === name)
      if (tool && tool.available === false) return
      selected.value = selected.value.includes(name)
        ? selected.value.filter((n) => n !== name)
        : [...selected.value, name]
      // 用户动过了 → 以后别再用后端的默认覆盖他的选择
      decided.value = true
    }

    return {
      list,
      selected,
      decided,
      loaded,
      toolsParam,
      reconcileSelection,
      loadTools,
      toggleTool,
    }
  },
  {
    /**
     * 持久化
     *
     * <p>⚠️ 只存 selected(用户勾了哪些)和 decided(是不是用户自己选的),
     *    不存 list(后端给的清单)——
     *    清单存下来 = 把「后端现在有哪些工具」钉死在前端。
     */
    persist: {
      key: STORAGE_KEYS.tools,
      pick: ['selected', 'decided'],
      storage: safeStorage,
      /**
       * 读回来之后对一遍:别的标签页存的勾选里,可能有这个后端已经删掉的工具
       * (后端升级过、工具被移除)—— 带着它发请求后端会 400。
       */
      afterHydrate: ({ store }) => store.reconcileSelection(),
    },
  }
)

// 跨标签页同步:另一个标签页改了勾选,这边也跟着变
// (说明见 stores/model.js 里同一段注释)
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEYS.tools) return
    useToolStore().$hydrate()
  })
}
