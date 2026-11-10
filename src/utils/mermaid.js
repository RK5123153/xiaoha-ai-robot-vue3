/**
 * mermaid 流程图渲染
 *
 * 被动态 import —— mermaid 的 ESM 入口只有 31 KB，
 * 具体图类型（flowchart / sequence / gantt…）是按需再拆包的，
 * 所以「只有真的出现流程图时才下载」这件事，mermaid 自己就做得很好。
 *
 * 为什么要单独一个模块：
 *   mermaid.render() 需要真实 DOM（它会先造一个临时节点再取出里面的 SVG），
 *   而且是异步的，必须和渲染管线异步配合。
 */

/** 已加载的 mermaid 实例（Promise 缓存，保证只加载一次） */
let mermaidPromise = null

const loadMermaid = async () => {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((mod) => {
      const mermaid = mod.default ?? mod
      mermaid.initialize({
        startOnLoad: false,
        // strict：mermaid 默认会消毒 SVG 里的脚本，别关
        securityLevel: 'strict',
        theme: 'default',
        fontFamily: 'inherit',
        /**
         * 布局引擎选 dagre 而不是 mermaid 的默认 elk
         *
         * mermaid v12 默认用 elk 布局，elk 会被单独打成一个 chunk：
         *   elk        1499 kB（gzip 466 kB）
         *   dagre        47 kB（gzip  17 kB）
         * 差 450 kB —— 对一个聊天页面来说太奢侈了。
         *
         * dagre 是 mermaid v10 及更早版本的默认布局，渲染效果没本质区别，
         * 教程/示例里的图也都是这个效果。而且 dagre 是同步的，渲染更快。
         *
         * 如果以后确实需要 elk 更好的布局质量（复杂子图、长边标签），
         * 把它改回 'elk' 即可 —— elk 的 chunk 是懒加载的，只有真渲染图时才下载。
         */
        layout: 'dagre',
        /**
         * ⚠️ suppressErrorRendering 必须开，否则报错会跑到聊天框外面去
         *
         * mermaid v12 解析失败时的默认流程（node_modules/mermaid/dist/mermaid.core.mjs）：
         *   1. 在 document.body 里塞一个临时节点 <div id="dmmd-N"><svg id="mmd-N">
         *   2. 把「Syntax error in text / mermaid version 12.3.0 / Parse error on line N」
         *      画进那个 svg
         *   3. 抛异常之前**没有**清理这个节点 —— 源码里是
         *      `if (parseEncounteredException) throw parseEncounteredException`
         *      写在 removeTempElements() **之前**，直接 return 不到清理那一步
         *
         * 于是这个报错图就永远留在 body 里。咱们的 #app 是 100dvh 撑满一屏的，
         * 这个节点就成了 #app 的兄弟节点 —— 显示在「输入框下面」，
         * 也就是用户看到的「对话框下面会出现报错」。
         * 流式输出时每个分片都会重新解析一次半截的流程图，
         * 一次回答就能攒出几十上百个这种报错图。
         *
         * 打开这个开关后：解析失败直接抛异常，临时节点也会被清掉。
         * 错误由 markdown.js 那边 catch 住，退回「按代码块显示源码」。
         */
        suppressErrorRendering: true,
      })
      return mermaid
    })
  }
  return mermaidPromise
}

/**
 * 已渲染好的图缓存：源码 -> { svg, id }
 *
 * 为什么需要缓存：流式输出时整条消息每来一个分片就要重渲染一次，
 * 不缓存的话同一张图会被反复渲染（mermaid 单张图要几十到几百毫秒）。
 */
const svgCache = new Map()
/** 缓存上限：聊天里翻久了会攒很多图，超了就整体清掉 */
const SVG_CACHE_MAX = 100

/**
 * 解析失败的源码缓存
 *
 * 失败是**确定性**的：同一段源码再解析一次还是失败。
 * 不缓存的话，一段写坏了的流程图会被反复解析 —— 每来一个分片就试一次，
 * 白白浪费 CPU（还会刷一堆 mermaid 的报错日志）。
 */
const failedCache = new Set()
const FAILED_CACHE_MAX = 100

/** 渲染 id 计数器，保证同一张图在页面里出现多次时 id 不冲突 */
let idSeq = 0

/**
 * 渲染时的「临时画布」
 *
 * mermaid.render(id, text, container) 的第三个参数是放图的容器。
 * 两个坑：
 *
 * 1. **容器必须挂在 document.body 下面**（不能是游离节点）。
 *    mermaid 内部的渲染器是靠 id 去 body 里找 svg 的
 *    （selectSvgElement → document.body.querySelector('#' + id)），
 *    容器游离的话渲染器找不到 svg，图形会被画到空处 ——
 *    不报错，但拿回来的是一张空图。
 *
 * 2. **容器要留在 body 里面但不能被看见**。
 *    mermaid 默认是把临时节点直接挂在 body 上（一个没有任何样式的 div），
 *    渲染期间它是**可见的** —— 图会闪在页面底部（输入框下面），
 *    解析失败时那张报错图更是直接留在那儿不走（见 suppressErrorRendering 的说明）。
 *    所以我们自己造一个容器：挂在 body 上、挪到屏幕外、尺寸照着 body 给，
 *    渲染完整个删掉。这样页面上一个像素都不会多，
 *    就算 mermaid 自己不清理临时节点，我们的容器也会把它一起带走。
 *
 * 尺寸要照着 body 给（width:100%）：mermaid 的 svg 是 width="100%"，
 * 容器窄了图就会按窄的宽度排版，跟默认路径画出来的不一样。
 * （Tailwind 的 preflight 把 body 的 margin 清了，所以 body 宽度 = 视口宽度，
 *   绝对定位的 100% 正好等于它。）
 * 不能用 display:none —— 那样 getBBox() 量不到文字尺寸，图会排歪。
 */
const createHolder = () => {
  const holder = document.createElement('div')
  holder.setAttribute('aria-hidden', 'true')
  holder.style.cssText =
    'position:absolute;left:-99999px;top:0;width:100%;height:0;overflow:hidden;pointer-events:none;'
  document.body.appendChild(holder)
  return holder
}

/**
 * 把 mermaid 源码渲染成 SVG 字符串
 *
 * @param {string} source mermaid 源码
 * @returns {Promise<string>} SVG 字符串；渲染失败时抛异常，由调用方兜底
 */
export const renderMermaidSvg = async (source) => {
  const cached = svgCache.get(source)
  if (cached) {
    // 复用缓存的 SVG，但把 id 换成新的：
    // SVG 内部有 id="xxx" / url(#xxx) / #xxx 这些引用，
    // 同一个 id 在页面里出现两次就会互相串。
    const newId = `mmd-${++idSeq}`
    return cached.svg.split(cached.id).join(newId)
  }
  if (failedCache.has(source)) throw new Error('mermaid 源码解析失败（已缓存）')

  const mermaid = await loadMermaid()
  const id = `mmd-${++idSeq}`

  // 非浏览器环境（单元测试跑在 Node 里）没有 document，
  // 这时传 undefined —— mermaid 会当成「没指定容器」，走它自己的默认路径
  const holder = typeof document !== 'undefined' ? createHolder() : undefined

  try {
    const { svg } = await mermaid.render(id, source, holder)
    if (svgCache.size >= SVG_CACHE_MAX) svgCache.clear()
    svgCache.set(source, { svg, id })
    return svg
  } catch (e) {
    if (failedCache.size >= FAILED_CACHE_MAX) failedCache.clear()
    failedCache.add(source)
    throw e
  } finally {
    // 容器整个删掉 —— mermaid 的临时节点在它里面，一并带走
    holder?.remove()
  }
}

/**
 * 判断一段源码是不是「看起来像」mermaid
 *
 * 用途：模型偶尔会在 ```mermaid 块里写别的东西（或者写错了图类型），
 * 这时没必要真去调 mermaid.parse —— 直接按代码块显示即可，
 * 省掉一次必然失败的解析。
 *
 * 判断依据是**第一行有意义的代码**：mermaid 允许在图前面写注释
 * （%% 开头的行）和初始化指令（%%{init: {...}}%%），
 * 直接看第一行会把这些合法的写法误判成「不是 mermaid」。
 *
 * @param {string} source
 * @returns {boolean}
 */
export const looksLikeMermaid = (source) => {
  const first = (source || '')
    .split('\n')
    .map((line) => line.trim())
    // 跳过空行、注释行（%%）、初始化指令行（%%{...}%%）
    .find((line) => line && !line.startsWith('%%'))
  if (!first) return false
  // mermaid 的图类型关键字
  return /^(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|mindmap|timeline|quadrantChart|gitGraph|C4Context|requirementDiagram|xychart-beta|sankey-beta|block-beta|packet-beta|architecture-beta|kanban|radar|treemap)\b/i.test(
    first
  )
}
