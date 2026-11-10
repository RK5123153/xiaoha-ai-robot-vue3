/**
 * 代码高亮（highlight.js）
 *
 * 为什么不用 highlight.js/lib/common：
 *   common 是 36 种语言，core + 语言文件合计 366 KB（未压缩）。
 *   这里只注册 AI 回答里最常出现的 14 种，合计 190 KB —— 少一半，首屏少传 50 KB gzip。
 *
 * 少了的语言怎么办：
 *   渲染器会先问 hljs.getLanguage(lang)，不认识就原样输出代码（不报错、不高亮）。
 *   比如模型输出 ```ruby，代码照样显示，只是不带颜色。
 *
 * 这个文件是被动态 import 的（见 utils/markdown.js），
 * 所以它会单独打成一个 chunk，只有出现代码块时才下载。
 */
import hljs from 'highlight.js/lib/core'

import xml from 'highlight.js/lib/languages/xml'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import plaintext from 'highlight.js/lib/languages/plaintext'
import python from 'highlight.js/lib/languages/python'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import yaml from 'highlight.js/lib/languages/yaml'

// html 本质就是 xml 的方言，xml 语言包已经能覆盖
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('css', css)
hljs.registerLanguage('diff', diff)
hljs.registerLanguage('go', go)
hljs.registerLanguage('java', java)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('json', json)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('plaintext', plaintext)
hljs.registerLanguage('python', python)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('yaml', yaml)

// 常见的别名，让 ```js / ```ts / ```sh / ```yml 也能命中
hljs.registerAliases(['html', 'htm', 'svg', 'vue'], { languageName: 'xml' })
hljs.registerAliases(['js', 'jsx', 'mjs', 'cjs'], { languageName: 'javascript' })
hljs.registerAliases(['ts', 'tsx'], { languageName: 'typescript' })
hljs.registerAliases(['sh', 'shell', 'zsh'], { languageName: 'bash' })
hljs.registerAliases(['yml'], { languageName: 'yaml' })
hljs.registerAliases(['py'], { languageName: 'python' })
hljs.registerAliases(['text', 'txt'], { languageName: 'plaintext' })

export default hljs
