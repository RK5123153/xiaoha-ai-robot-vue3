/**
 * 模型 + 联网搜索 —— 全局设置
 *
 * <p>首页和聊天页是**两个页面组件**,但「用哪个模型」「开不开联网搜索」
 *    是同一份设置 —— 所以它必须活得比页面长。
 *
 * <p>为什么用 Pinia 而不是自己写个 reactive 对象:
 * <ul>
 *   <li>工具链现成:Vue DevTools 里能直接看状态、改状态、回放时间线
 *       (调「为什么这次请求带了 networkSearch」这种问题时省事)。</li>
 *   <li>持久化是**声明式**的:persist 选项写清楚「哪些字段要存」,
 *       不用自己在每个 action 里记得写 localStorage。</li>
 *   <li>Pinia 是 Vue 官方推荐的状态管理库 —— 教程里的方案,也是长期看更省心的方案。</li>
 * </ul>
 *
 * <p>⚠️ 持久化只存**用户的选择**(code / webSearch),
 *    不存后端给的清单(models) —— 清单每次都重新拉,
 *    存下来就等于把「后端现在有哪些模型」钉死在前端,后端加模型前端不知道、
 *    后端删了模型前端还在发一个已经不存在的 modelName(后端会 400)。
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { modelApi } from '@/api/model.js'
import { safeStorage } from '@/utils/storage.js'
import { STORAGE_KEYS } from './keys.js'

/**
 * 模型清单的「保鲜期」
 *
 * <p>模型清单是后端说了算的,而后端随时可能加减模型。
 *    清单只在本页面打开时拉一次的话,后端新加的模型用户要刷新页面才看得到;
 *    超过这段时间还没人打开过下拉框,下次打开就顺手重新拉一遍。
 */
const LIST_TTL = 5 * 60 * 1000

export const useModelStore = defineStore(
  'model',
  () => {
    /** 后端可选的模型清单 */
    const models = ref([])
    /** 当前选的模型 code;空字符串 = 用后端配置的默认模型 */
    const code = ref('')
    /** 当前是否联网搜索(用户自己的偏好) */
    const webSearch = ref(false)
    /** 清单拿到了没 —— 没拿到就不知道有哪些模型可选 */
    const loaded = ref(false)
    /** 清单拉到的时刻(判断是不是过期了) */
    const loadedAt = ref(0)

    /**
     * 当前选中的那个模型(按 code 在清单里找)
     *
     * <p>⚠️ 找不到时返回 null 有两种原因,含义不一样:
     *   · code 是空的 → 用后端默认模型(正常)
     *   · code 有值但清单里没有 → 后端不认识这个模型了(该退回默认)
     */
    const currentModel = computed(
      () => models.value.find((m) => m.code === code.value) || null
    )

    /**
     * 本次请求「实际」要不要联网搜索
     *
     * <p>⚠️ 用户开着、但选的模型不支持 → **不能**发 networkSearch=true:
     *    后端对这种情况直接 400(它不静默降级 —— 照常回答只是没搜,
     *    会让人以为「搜过了」,拿到的却是模型的过时知识,比报错更难发现)。
     *    所以这里降级成 false,并把原因带回去,由界面告诉用户「本次没有联网」。
     *
     * <p>⚠️ code 为空(用后端配的默认模型)时,前端**不知道**它支不支持 ——
     *    后端没把「哪个是默认」标出来。这种情况按「支持」处理:
     *    真不支持的话,后端会返回一句人话错误(「请换一个支持联网搜索的模型…」)。
     *
     * @returns {{enabled: boolean, reason: string}} reason 非空 = 被降级了,得告诉用户
     */
    const webSearchStatus = computed(() => {
      if (!webSearch.value) return { enabled: false, reason: '' }
      const model = currentModel.value
      if (model && model.webSearch === false) {
        return { enabled: false, reason: `「${model.name}」不支持联网搜索,本次没有联网` }
      }
      return { enabled: true, reason: '' }
    })

    /**
     * 清单是不是该重新拉了
     *
     * <p>⚠️ 写成**函数**而不是 computed:`Date.now()` 不是响应式的,
     *    computed 会把结果缓存住 —— 一小时前算过一次,再问它还是那个旧答案。
     *
     * @returns {boolean}
     */
    const isStale = () => !loaded.value || Date.now() - loadedAt.value > LIST_TTL

    /**
     * 拉模型清单
     *
     * <p>⚠️ 拉失败**不**把 loaded 置 true —— 这样下次(比如用户打开模型下拉框)
     *    还能再拉一次。后端晚起一会儿,前端自己能恢复,不用用户刷新页面。
     *
     * @returns {Promise<void>}
     */
    const loadModels = async () => {
      if (!isStale()) return
      let list = []
      try {
        list = await modelApi.list()
      } catch (e) {
        console.warn('拉模型清单失败:', e)
        return
      }
      models.value = list
      loaded.value = true
      loadedAt.value = Date.now()

      // ⚠️ 持久化下来的 code 可能已经过期了(后端换过模型 / 改过 modelName):
      //    这时候还照发,后端会 400(「模型不存在」),而用户根本没做什么,
      //    只看到「发不出消息」—— 查起来很费劲。所以直接退回后端默认模型。
      //    (清单是空数组时**不**清:那是后端挂了,不是模型没了,别把用户的设置擦掉)
      if (code.value && list.length && !list.some((m) => m.code === code.value)) {
        code.value = ''
      }
    }

    /**
     * 选模型
     *
     * <p>⚠️ 这里**不碰** webSearch:联网搜索是用户自己的偏好,
     *    和「用哪个模型」是两件事。
     *    以前选模型的时候顺手把联网搜索对齐到模型的能力,结果用户勾上的联网搜索
     *    被模型切换悄悄改掉 —— 换个不支持联网的模型,搜索就被关了,
     *    用户会以为是自己关的,更糟的是「我明明开着联网」却没搜。
     *
     * @param {string} c 模型 code;空 = 用后端默认
     */
    const selectModel = (c) => {
      code.value = c || ''
    }

    /** 开 / 关联网搜索 */
    const toggleWebSearch = () => {
      webSearch.value = !webSearch.value
    }

    return {
      models,
      code,
      webSearch,
      loaded,
      loadedAt,
      currentModel,
      webSearchStatus,
      isStale,
      loadModels,
      selectModel,
      toggleWebSearch,
    }
  },
  {
    /**
     * 持久化
     *
     * <p>⚠️ `pick` 是白名单:**只**存用户的选择。
     *    models(后端给的清单)和 loaded(有没有拉到过)都不存 ——
     *    存了 loaded 的话,下次打开页面会以为「清单已经拉过了」而不再拉,
     *    下拉框里就永远是空的;存了 models 的话,后端改了模型前端还拿着旧的。
     *
     * <p>⚠️ 只存 code(字符串)而不存整个模型对象:
     *    模型名字/说明是后端说了算的,存一份快照下来,后端改了名字前端还显示旧的。
     */
    persist: {
      key: STORAGE_KEYS.model,
      pick: ['code', 'webSearch'],
      storage: safeStorage,
    },
  }
)

// 跨标签页同步:另一个标签页改了设置,这边也跟着变
//
// ⚠️ 这个事件**只在别的标签页**里触发(写的那边自己收不到),
//    所以不会出现「A 写 → B 同步 → B 又写 → A 再同步」的来回 ——
//    而且浏览器规范里,写进去的值和原来一样时**不**触发事件,天然收敛。
//
// ⚠️ 别把草稿也加进来:两个标签页开着**同一个会话**时,
//    草稿同步过去会把这边正在打的字冲掉(那是灾难,不是同步)。
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEYS.model) return
    // $hydrate 是持久化插件给 store 加的:把存着的值读回来盖到 state 上
    useModelStore().$hydrate()
  })
}
