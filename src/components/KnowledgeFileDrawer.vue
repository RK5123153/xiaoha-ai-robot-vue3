<template>
  <!--
    客服问答文件管理 —— 一个 Drawer:条件查询 + 上传 Markdown 问答文件 + 分页列表 + 备注/删除。

    ⚠️ 这不是「设置」页,是**知识库的运营台**:
       问答文件决定客服能答什么,上传完还要等后台切分 + 向量化(状态会自己变),
       所以列表得能刷、能筛、能看状态、能改备注、能删。

    ⚠️ **上传只是第一步**:后端同步接口只落库(状态「待处理」),
       切分和调 embedding 是后台线程干的活 —— 所以这里上传完不提示「已完成」,
       而是刷新列表让用户看见「待处理 → 向量化中 → 已完成」这一段变化。

    ⚠️ **两个抽屉都是可伸缩的**(拖左边那条线):
       列表列多,固定宽度的话总有一半列在屏幕外(得横向滚,看文件名尤其难受);
       失败原因那种长文本更不能塞在表格单元格里 —— 放详情抽屉里。
  -->
  <a-drawer
    :open="open"
    placement="right"
    :width="listWidth"
    title="客服问答文件管理"
    :body-style="{ padding: '16px 24px 24px', scrollbarGutter: 'stable' }"
    @close="close"
  >
    <!-- 伸缩把手:抽屉左边那条线,拖着它改宽度 -->
    <span
      class="drawer-resizer"
      role="separator"
      aria-label="拖动调整抽屉宽度"
      @mousedown="startListResize($event)"
    ></span>

    <!--
      反馈条。
      ⚠️ **别用 antd 的 message(轻提示)**:它在屏幕顶部居中,抽屉正好占着那一块 ——
         提示会压在抽屉标题上,还可能被抽屉盖住,用户根本看不见。
         放在抽屉里面,用户眼睛本来就在这儿。
    -->
    <a-alert
      v-if="feedback"
      :type="feedback.type"
      :message="feedback.text"
      show-icon
      closable
      class="mb-3"
      @close="clearFeedback"
    />

    <!--
      条件查询:文件名称(模糊) / 创建时间段 / 处理状态。
      ⚠️ **三个条件一起生效,点「查询」才生效**:
         状态筛选原来挂在工具条上、选一下就刷新,挪进查询区是为了让「重置」有明确的意思(全清)。
         代价是筛状态也得点一下查询 —— 换来的是「界面上摆着的条件 = 正在生效的条件」,
         不会出现「下拉框显示『失败』、表格却是全部」这种对不上的情况。
    -->
    <div class="mb-3 rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2.5">
      <div class="flex flex-wrap items-end gap-x-3 gap-y-2">
        <div class="flex flex-col gap-1">
          <label class="text-xs text-gray-500" for="cs-file-name">文件名称</label>
          <a-input
            id="cs-file-name"
            v-model:value="form.fileName"
            class="w-60"
            placeholder="模糊查询(比如「退换货」)"
            allow-clear
            @press-enter="applyQuery"
          />
        </div>

        <div class="flex flex-col gap-1">
          <span class="text-xs text-gray-500">创建时间</span>
          <!--
            ⚠️ 用 {@code value-format} 而不是 dayjs 对象:
               传字符串进来,省掉一层 .format() —— 也省掉「清空之后那半边是 null」
               那个坑(antd 清空时给的是 null,不是 [])。
          -->
          <a-range-picker
            v-model:value="form.dateRange"
            value-format="YYYY-MM-DD"
            :placeholder="['开始日期', '结束日期']"
            aria-label="按创建时间筛选"
          />
        </div>

        <div class="flex flex-col gap-1">
          <span class="text-xs text-gray-500">处理状态</span>
          <a-select
            v-model:value="form.status"
            class="w-32 cs-status-select"
            :options="statusOptions"
            aria-label="按处理状态筛选"
          />
        </div>

        <div class="flex items-center gap-2">
          <a-button type="primary" :loading="loading" @click="applyQuery">
            <template #icon><SearchOutlined /></template>
            查询
          </a-button>
          <a-button @click="resetQuery">
            <template #icon><RedoOutlined /></template>
            重置
          </a-button>
        </div>

        <!-- 有条件在生效时说清楚:不然用户会以为「我的文件怎么只剩这么点」 -->
        <span v-if="hasActiveQuery" class="ml-auto text-xs text-gray-400">
          只显示符合条件的文件(共 {{ total }} 条)
        </span>
      </div>
    </div>

    <!-- 工具条:上传 / 刷新 / 批量删除 -->
    <div class="flex flex-wrap items-center gap-2 mb-3">
      <a-upload
        accept=".md,text/markdown"
        :show-upload-list="false"
        :multiple="false"
        :disabled="uploading"
        :before-upload="beforeUpload"
        :custom-request="doUpload"
      >
        <a-button type="primary" :loading="uploading">
          <template #icon><UploadOutlined /></template>
          上传 Markdown 文件
        </a-button>
      </a-upload>

      <a-tooltip title="重新拉一遍列表" placement="bottom">
        <a-button :loading="loading" aria-label="刷新文件列表" @click="loadFiles()">
          <template #icon><ReloadOutlined /></template>
        </a-button>
      </a-tooltip>

      <!--
        批量删除。
        ⚠️ 只有选了行才出现 —— 免得一个常驻的红色按钮杵在那儿吓着人。
      -->
      <a-popconfirm
        v-if="selectedKeys.length"
        :title="`删除选中的 ${selectedKeys.length} 个文件?删了不可恢复(文件和向量都会清掉)`"
        ok-text="删除"
        cancel-text="取消"
        :ok-button-props="{ danger: true }"
        @confirm="doBatchDelete"
      >
        <a-button danger>
          删除所选({{ selectedKeys.length }})
        </a-button>
      </a-popconfirm>

      <!-- 提示:上传只是落库,还得等后台处理 -->
      <span class="ml-auto text-xs text-gray-400">上传后需等待切分与向量化,状态会自动更新</span>
    </div>

    <!-- 列表 -->
    <a-table
      row-key="id"
      size="small"
      :columns="columns"
      :data-source="files"
      :pagination="pagination"
      :loading="loading"
      :row-selection="rowSelection"
      :scroll="scroll"
      @change="handleTableChange"
    >
      <!--
        表头:标题 + 一条可以拖的竖线。
        ⚠️ antd v4 的 Vue 版**没有**现成的「可拖拽列宽」(React 版要传 components.header.cell),
           这里自己实现:拖动时改列的 width,列宽存进 localStorage,下次打开还是这么宽。
      -->
      <template #headerCell="{ column }">
        <div class="col-head">
          <span class="col-head-title">{{ column.title }}</span>
          <span
            class="col-resizer"
            role="separator"
            aria-label="拖动调整列宽"
            @mousedown="startColumnResize($event, column)"
          ></span>
        </div>
      </template>

      <template #bodyCell="{ column, record }">
        <!-- 文件名:点一下进**完整详情** -->
        <template v-if="column.key === 'originalFileName'">
          <button
            type="button"
            class="name-btn"
            :title="record.originalFileName"
            :aria-label="`查看「${record.originalFileName}」的详情`"
            @click="openDetail(record, 'full')"
          >
            {{ record.originalFileName }}
          </button>
        </template>

        <!--
          状态:**只有失败的文件能点**,点开就是失败原因。
          ⚠️ 失败原因**不往单元格里塞** —— 那玩意儿有的一屏长,
             塞进表格会把整张表撑变形(而且还得靠悬停才看得到,等于没有)。
             单元格只放一个状态标签,点它去单独的一页里看完整原因。
        -->
        <template v-else-if="column.key === 'status'">
          <a-tooltip v-if="record.status === 3" title="点击查看失败原因" placement="top">
            <button
              type="button"
              class="status-btn"
              :aria-label="`查看「${record.originalFileName}」的失败原因`"
              @click="openDetail(record, 'error')"
            >
              <a-tag color="error">{{ statusText(record) }}</a-tag>
            </button>
          </a-tooltip>
          <a-tag v-else :color="statusColor(record.status)">{{ statusText(record) }}</a-tag>
        </template>

        <!-- 切块/向量:向量化到底做没做成,看这两个数最直观 -->
        <template v-else-if="column.key === 'chunks'">
          <span v-if="record.chunkCount || record.vectorCount" class="text-gray-600">
            {{ record.chunkCount ?? 0 }} / {{ record.vectorCount ?? 0 }}
          </span>
          <span v-else class="text-gray-300">—</span>
        </template>

        <!-- 备注:空的话写「—」,别留一个看着像有内容其实没有的空格 -->
        <template v-else-if="column.key === 'remark'">
          <span :class="record.remark ? 'text-gray-700' : 'text-gray-300'">
            {{ record.remark || '—' }}
          </span>
        </template>

        <!-- 操作 -->
        <template v-else-if="column.key === 'action'">
          <div class="flex items-center gap-1">
            <a-button type="link" size="small" @click="openRemark(record)">备注</a-button>

            <!--
              ⚠️ 「待处理 / 向量化中」的文件删不掉(后端业务码 20010):
                 异步线程可能正拿着它干活,删了只会让那次向量化白跑。
                 所以这里**提前把按钮禁掉**,并说清为什么 —— 而不是让用户点了才吃一个后端的拒绝。
            -->
            <a-popconfirm
              v-if="!isProcessing(record)"
              title="删除后不可恢复(文件和向量都会清掉),确定删除?"
              ok-text="删除"
              cancel-text="取消"
              :ok-button-props="{ danger: true }"
              @confirm="doDelete(record)"
            >
              <a-button type="link" size="small" danger :loading="deleting.has(record.id)">删除</a-button>
            </a-popconfirm>
            <a-tooltip v-else title="文件正在处理中,等处理结束后才能删除" placement="top">
              <!-- ⚠️ 套一层 span:禁用的按钮不派发鼠标事件,tooltip 挂它身上弹不出来 -->
              <span>
                <a-button type="link" size="small" danger disabled>删除</a-button>
              </span>
            </a-tooltip>
          </div>
        </template>
      </template>

      <!--
        空状态:别只写一句「暂无数据」,告诉用户下一步该干什么。
        ⚠️ **筛出来的空**和**真的一个文件都没有**是两回事:
           前者该让人去改条件,后者该让人去上传 —— 混成一句「暂无数据」两头都指不到。
      -->
      <template #emptyText>
        <div class="py-10 text-center">
          <template v-if="hasActiveQuery">
            <p class="mb-1 text-sm text-gray-500">没有符合条件的文件</p>
            <p class="m-0 text-xs text-gray-400">换个条件,或者点「重置」看全部</p>
          </template>
          <template v-else>
            <p class="mb-1 text-sm text-gray-500">还没有问答文件</p>
            <p class="m-0 text-xs text-gray-400">上传 Markdown 问答文件,客服才能据此作答</p>
          </template>
        </div>
      </template>
    </a-table>

    <!-- 改备注 -->
    <a-modal
      v-model:open="remarkOpen"
      title="编辑备注"
      ok-text="保存"
      cancel-text="取消"
      :confirm-loading="remarkSaving"
      :z-index="1100"
      @ok="saveRemark"
    >
      <a-textarea
        v-model:value="remarkText"
        :maxlength="200"
        show-count
        :rows="4"
        placeholder="给这个文件写点说明(比如「退换货政策,2026 版」)"
      />
      <p class="mt-2 mb-0 text-xs text-gray-400">
        备注只给人看,不会进检索 —— 客服回答的依据是文件正文。
      </p>
    </a-modal>
  </a-drawer>

  <!--
    详情抽屉 —— 两个入口两种看法:
    · 点**文件名** → 全部详情(文件名+复制、状态、id、哈希、块数、时间、备注);
    · 点**失败的状态** → 只看失败原因(那一段常常很长,单独占一页才看得全)。
  -->
  <a-drawer
    :open="detailOpen"
    placement="right"
    :width="detailWidth"
    :z-index="1040"
    :title="detailMode === 'error' ? '失败原因' : '问答文件详情'"
    :body-style="{ padding: '16px 24px 24px', scrollbarGutter: 'stable' }"
    @close="detailOpen = false"
  >
    <span
      class="drawer-resizer"
      role="separator"
      aria-label="拖动调整抽屉宽度"
      @mousedown="startDetailResize($event)"
    ></span>

    <!-- 只看失败原因 -->
    <template v-if="detail && detailMode === 'error'">
      <p class="mt-0 mb-2 break-all text-sm text-gray-500">{{ detail.originalFileName }}</p>
      <div class="rounded-lg border border-red-200 bg-red-50 p-3">
        <p class="m-0 whitespace-pre-wrap break-words text-sm leading-relaxed text-red-700">
          {{ detail.errorMsg || '没有留下失败原因' }}
        </p>
      </div>
      <a-button type="link" class="mt-3" @click="detailMode = 'full'">
        查看完整详情
        <RightOutlined />
      </a-button>
    </template>

    <!-- 全部详情 -->
    <template v-else-if="detail">
      <!-- 文件名 + 复制(复制放在这儿,不占表格的操作栏) -->
      <div class="flex items-start gap-2 mb-1">
        <h3 class="m-0 flex-1 break-all text-base font-medium text-gray-800">
          {{ detail.originalFileName }}
        </h3>
        <a-tooltip title="复制文件名" placement="top">
          <a-button type="link" size="small" aria-label="复制文件名" @click="copyName(detail)">
            <CopyOutlined />
          </a-button>
        </a-tooltip>
        <!--
          复制结果就地显示。
          ⚠️ 不能用抽屉外那条反馈条 —— 详情抽屉正盖着它,提示等于没提示。
        -->
        <span
          v-if="copyState"
          class="mt-1 shrink-0 text-xs"
          :class="copyState.type === 'success' ? 'text-green-600' : 'text-red-500'"
        >{{ copyState.text }}</span>
      </div>

      <div class="mb-4 flex items-center gap-2">
        <a-tag :color="statusColor(detail.status)">{{ statusText(detail) }}</a-tag>
        <span class="text-xs text-gray-400">{{ detail.fileSizeText || formatBytes(detail.fileSize) }}</span>
      </div>

      <!-- 失败原因:完整的一段,不截断 -->
      <div
        v-if="detail.status === 3 && detail.errorMsg"
        class="mb-4 rounded-lg border border-red-200 bg-red-50 p-3"
      >
        <p class="m-0 mb-1 text-xs font-medium text-red-600">失败原因</p>
        <p class="m-0 whitespace-pre-wrap break-words text-sm text-red-700">{{ detail.errorMsg }}</p>
      </div>

      <!-- 明细 -->
      <dl class="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt class="text-gray-500">文件 ID</dt>
        <dd class="m-0 text-gray-800">{{ detail.id }}</dd>

        <dt class="text-gray-500">落盘文件名</dt>
        <dd class="m-0 break-all text-gray-800">{{ detail.newFileName || '—' }}</dd>

        <dt class="text-gray-500">内容哈希</dt>
        <dd class="m-0 break-all text-xs text-gray-600">{{ detail.fileHash || '—' }}</dd>

        <dt class="text-gray-500">切块 / 向量</dt>
        <dd class="m-0 text-gray-800">
          {{ detail.chunkCount ?? 0 }} 块 / {{ detail.vectorCount ?? 0 }} 条向量
        </dd>

        <dt class="text-gray-500">向量模型</dt>
        <dd class="m-0 text-gray-800">{{ detail.embeddingModel || '—' }}</dd>

        <dt class="text-gray-500">所属知识库</dt>
        <dd class="m-0 text-gray-800">{{ detail.kbId ?? '默认知识库' }}</dd>

        <dt class="text-gray-500">创建时间</dt>
        <dd class="m-0 text-gray-800">{{ formatTime(detail.createTime) }}</dd>

        <dt class="text-gray-500">更新时间</dt>
        <dd class="m-0 text-gray-800">{{ formatTime(detail.updateTime) }}</dd>

        <dt class="text-gray-500">备注</dt>
        <dd class="m-0 flex items-start gap-1 text-gray-800">
          <span class="flex-1 break-all">{{ detail.remark || '—' }}</span>
          <a-button type="link" size="small" @click="openRemark(detail)">编辑</a-button>
        </dd>
      </dl>
    </template>
  </a-drawer>
</template>

<script setup>
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { customerServiceApi } from '@/api/customer-service.js'
import { describeError } from '@/api/base.js'
import { copyText } from '@/utils/clipboard.js'
import { safeGetItem, safeSetItem } from '@/utils/storage.js'

const props = defineProps({
  /** 抽屉是否打开(v-model:open) */
  open: { type: Boolean, default: false },
})
const emit = defineEmits(['update:open'])

/** 列表里的文件 */
const files = ref([])
/** 总条数(后端给,不是自己算的) */
const total = ref(0)
/** 当前页号(从 1 开始) */
const current = ref(1)
/** 一页多少条 */
const pageSize = ref(10)
/** 正在拉列表 */
const loading = ref(false)
/** 正在上传 */
const uploading = ref(false)
/** 正在删除的文件 id */
const deleting = reactive(new Set())
/** 勾选中的行 key */
const selectedKeys = ref([])

/**
 * 查询条件 —— **存两份**:填的和生效的。
 *
 * <p>⚠️ 分成两份是有原因的:抽屉里每隔几秒会**悄悄刷新**一次列表
 *    (处理中的文件状态在变)。要是只存一份,用户刚敲了「退换货」还没点查询,
 *    悄悄刷新就会把这份**还没生效**的条件发出去 —— 表格内容变了,
 *    而用户完全不明白为什么变。
 *
 * <p>所以:{@link form} = 用户填的,{@link applied} = 点过「查询」才生效的那份。
 *    请求只认 {@link applied}。
 */
const form = reactive({
  /** 文件名(模糊) */
  fileName: '',
  /** 创建时间段:[开始, 结束],都是 {@code YYYY-MM-DD};没选 = null */
  dateRange: null,
  /** 处理状态:-1 = 全部 */
  status: -1,
})

/** 生效中的查询条件 */
const applied = reactive({
  /** 文件名(模糊) */
  fileName: '',
  /** 创建时间段:[开始, 结束];没选 = null */
  dateRange: null,
  /** 处理状态:-1 = 全部 */
  status: -1,
})

/** 现在是不是「筛着看」—— 空状态和提示条都要靠它 */
const hasActiveQuery = computed(
  () => !!applied.fileName || !!applied.dateRange?.length || applied.status >= 0
)

/**
 * 抽屉里的反馈条({type, text})
 *
 * <p>成功的话过几秒自己消失,失败的话**留着** —— 失败原因用户得能回头再看一眼。
 */
const feedback = ref(null)
/** 成功提示的自动消失定时器 */
let feedbackTimer = null

const showFeedback = (type, text, { autoClose = false } = {}) => {
  feedback.value = { type, text }
  clearTimeout(feedbackTimer)
  if (autoClose) {
    feedbackTimer = setTimeout(() => {
      feedback.value = null
    }, 4000)
  }
}

/** 关掉反馈条(用户点了 × ) */
const clearFeedback = () => {
  clearTimeout(feedbackTimer)
  feedback.value = null
}

/** 状态筛选项 */
const statusOptions = [
  { value: -1, label: '全部状态' },
  { value: 0, label: '待处理' },
  { value: 1, label: '向量化中' },
  { value: 2, label: '已完成' },
  { value: 3, label: '失败' },
]

/**
 * 状态的中文说明
 *
 * <p>后端给了 {@code statusDesc},直接用它的;它没有(老数据 / 后端换了字段)再退回本地这张表。
 */
const statusText = (record) => {
  const fallback = { 0: '待处理', 1: '向量化中', 2: '已完成', 3: '失败' }
  return record.statusDesc || fallback[record.status] || '未知'
}

/** 状态标签的颜色 */
const statusColor = (status) =>
  ({ 0: 'default', 1: 'processing', 2: 'success', 3: 'error' })[status] || 'default'

/** 是不是还在处理中(这种文件不让删) */
const isProcessing = (record) => record.status === 0 || record.status === 1

/** 文件大小(后端给了人类可读的那份,没有就自己换算) */
const formatBytes = (bytes) => {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n <= 0) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(2)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

/**
 * 时间 → 本地时间
 *
 * <p>后端给的是 ISO 字符串(Java 的 Instant 序列化的结果)。
 */
const formatTime = (value) => {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/* ──────────────────────────────────────────────────────────────────────
 * 宽度:抽屉可伸缩 + 列宽可拖拽,都记住
 *
 * ⚠️ antd v4 **两样都不支持**:
 *    · 抽屉宽度是死的(想改只能改 CSS);
 *    · 列宽也不能拖(React 版要传 components.header.cell)。
 *    所以这里自己实现 —— 运营天天在这个列表里干活,宽度合不合手很要紧。
 * ────────────────────────────────────────────────────────────────────── */

/** 抽屉宽度的最小值(px) */
const MIN_DRAWER_WIDTH = 380

/** 抽屉宽度的存储键 */
const LIST_WIDTH_KEY = 'cs-files-drawer-width'
const DETAIL_WIDTH_KEY = 'cs-files-detail-width'

/**
 * 拖宽度时加在抽屉面板上的 class
 *
 * <p>⚠️ 用来把 antd 的 {@code transition: all .3s} 关掉 —— 不断重播动画是「卡」的主因。
 */
const RESIZING_CLASS = 'xh-drawer-resizing'

/** 列宽的最小值(px)—— 再窄就没法看内容了 */
const MIN_COL_WIDTH = 56

/** 列宽记忆的存储键 */
const WIDTHS_KEY = 'cs-files-col-widths'

/** 勾选列的宽度(它不在 columns 里,算总宽时得加上) */
const SELECTION_WIDTH = 40

/**
 * 抽屉的初始宽度
 *
 * @param {string} key 存储键
 * @param {number} fallback 没存过时的默认值
 * @returns {number}
 */
const initialDrawerWidth = (key, fallback) => {
  const saved = Number(safeGetItem(key))
  if (Number.isFinite(saved) && saved >= MIN_DRAWER_WIDTH) return saved
  return Math.min(fallback, Math.round(window.innerWidth * 0.94))
}

/** 文件管理抽屉的宽度 */
const listWidth = ref(initialDrawerWidth(LIST_WIDTH_KEY, 1240))
/** 详情抽屉的宽度 */
const detailWidth = ref(initialDrawerWidth(DETAIL_WIDTH_KEY, 560))

/**
 * 拖抽屉的左边那条线改宽度
 *
 * <p>抽屉挂在屏幕右边,所以宽度 = 屏幕宽 - 鼠标的横坐标。
 *
 * <p>⚠️ **拖的时候不能靠响应式值改宽度**,三个原因:
 *   <ul>
 *     <li>antd 给 {@code .ant-drawer-content-wrapper} 加了 {@code transition: all .3s} ——
 *         每改一次宽度就重新播一遍动画,抽屉会「追着」鼠标慢半拍(用户说的「有延迟」就是这个);</li>
 *     <li>改响应式值 → 整个抽屉(含表格)每个 mousemove 重渲一次,行数越多越卡;</li>
 *     <li>mousemove 一秒能来上百次,浏览器一帧只显示一次 —— 多出来的那些纯属浪费。</li>
 *   </ul>
 *   所以:拖的时候**直接改 DOM 的 style**(过渡关掉 + rAF 合帧,一帧只改一次),
 *   松手才把最终宽度写回响应式值(顺带记住,下次打开还是这么宽)。
 *
 * @param {MouseEvent} event mousedown
 * @param {import('vue').Ref<number>} widthRef 宽度的 ref(松手时写回去)
 */
const startDrawerResize = (event, widthRef) => {
  if (event.button !== 0) return
  event.preventDefault()
  event.stopPropagation()

  // 抽屉面板(过渡就加在它身上)
  const panel = event.currentTarget.closest('.ant-drawer-content-wrapper')
  if (!panel) return

  const startX = event.clientX
  const startWidth = panel.offsetWidth
  let pending = startWidth
  let raf = 0

  const apply = () => {
    raf = 0
    panel.style.width = `${pending}px`
  }

  const onMove = (e) => {
    pending = Math.min(
      Math.max(startWidth - (e.clientX - startX), MIN_DRAWER_WIDTH),
      window.innerWidth - 40
    )
    // ⚠️ 一帧只改一次 —— 鼠标事件比刷新率快得多,全改就是白干
    if (raf) return
    raf = requestAnimationFrame(apply)
  }

  const onUp = () => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    if (raf) {
      cancelAnimationFrame(raf)
      apply()
    }
    // ⚠️ **别把 style 清空**:清空了、而响应式值又恰好没变的话,
    //    Vue 就不会重新写这个样式 —— 抽屉会直接没了宽度。
    //    留着最终值(和响应式值一样)最稳。
    panel.classList.remove(RESIZING_CLASS)
    panel.style.width = `${pending}px`
    // 最终宽度写回响应式值(顺带记住,下次打开还是这么宽)
    widthRef.value = pending
    safeSetItem(
      widthRef === listWidth ? LIST_WIDTH_KEY : DETAIL_WIDTH_KEY,
      String(pending)
    )
  }

  // 一开始就把过渡关掉 —— 不然第一帧就在播动画,看着更「黏」
  panel.classList.add(RESIZING_CLASS)

  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

/**
 * 表格列
 *
 * <p>⚠️ 用 {@code ref} 而不是普通常量:拖拽时要改列的 width,
 *    改完得让表格重新渲染 —— ref 里的对象是响应式的,改了会自动触发。
 */
const columns = ref([
  {
    title: '文件名称',
    dataIndex: 'originalFileName',
    key: 'originalFileName',
    width: 240,
    ellipsis: true,
  },
  {
    title: '文件大小',
    dataIndex: 'fileSizeText',
    key: 'fileSize',
    width: 100,
    customRender: ({ record }) => record.fileSizeText || formatBytes(record.fileSize),
  },
  {
    title: '状态',
    dataIndex: 'status',
    key: 'status',
    width: 100,
  },
  {
    title: '切块/向量',
    dataIndex: 'chunkCount',
    key: 'chunks',
    width: 90,
  },
  {
    title: '备注',
    dataIndex: 'remark',
    key: 'remark',
    width: 160,
    ellipsis: true,
  },
  {
    title: '创建时间',
    dataIndex: 'createTime',
    key: 'createTime',
    width: 150,
    // ⚠️ 后端给的是 ISO 字符串(Java 的 Instant)—— 直接显示是一串
    //    "2026-11-27T14:53:50.653Z",得转成看得了的时间
    customRender: ({ record }) => formatTime(record.createTime),
  },
  {
    title: '更新时间',
    dataIndex: 'updateTime',
    key: 'updateTime',
    width: 150,
    customRender: ({ record }) => formatTime(record.updateTime),
  },
  {
    title: '操作',
    key: 'action',
    width: 110,
    fixed: 'right',
  },
])

/**
 * 表格总宽 = 各列宽度之和 + 勾选列
 *
 * <p>⚠️ 不能写死一个数:写死了,用户把某列拖宽之后,
 *    table-layout: fixed 会把超宽的那部分**按比例压回去** —— 拖了等于没拖。
 */
const scroll = computed(() => ({
  x: columns.value.reduce((sum, c) => sum + (c.width || 0), 0) + SELECTION_WIDTH,
}))

/** 把记住的列宽套回列上 */
const restoreColumnWidths = () => {
  const raw = safeGetItem(WIDTHS_KEY)
  if (!raw) return
  try {
    const saved = JSON.parse(raw)
    columns.value.forEach((col) => {
      const width = saved[col.key]
      // ⚠️ 别把宽度存成 0 / 非法值 —— 那样表格会塌掉
      if (Number.isFinite(width) && width >= MIN_COL_WIDTH) col.width = width
    })
  } catch {
    /* 存的是坏数据,忽略 */
  }
}

/** 把现在的列宽存起来 */
const saveColumnWidths = () => {
  const map = {}
  columns.value.forEach((col) => {
    if (col.width) map[col.key] = col.width
  })
  safeSetItem(WIDTHS_KEY, JSON.stringify(map))
}

/**
 * 开始拖列宽
 *
 * @param {MouseEvent} event mousedown
 * @param {object} column  这一列(表头插槽给的,是响应式对象,改 width 就能生效)
 */
const startColumnResize = (event, column) => {
  if (event.button !== 0) return
  event.preventDefault()
  event.stopPropagation()

  const th = event.currentTarget.closest('th')
  if (!th) return

  const startX = event.clientX
  const startWidth = th.offsetWidth
  let pending = startWidth
  let raf = 0

  const onMove = (e) => {
    pending = Math.max(MIN_COL_WIDTH, startWidth + (e.clientX - startX))
    // ⚠️ 每来一个 mousemove 就重渲一次表格,会卡 —— 用 rAF 合帧
    if (raf) return
    raf = requestAnimationFrame(() => {
      raf = 0
      column.width = pending
    })
  }

  const onUp = () => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
    if (raf) cancelAnimationFrame(raf)
    saveColumnWidths()
  }

  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

/** 分页配置 */
const pagination = computed(() => ({
  current: current.value,
  pageSize: pageSize.value,
  total: total.value,
  showSizeChanger: true,
  pageSizeOptions: ['10', '20', '50'],
  // ⚠️ antd 的分页条**默认不显示总条数**:光把 total 传进去,右下角还是只有
  //    「1 2 3 … 10 条/页」,用户不知道一共多少个文件 —— 得自己写 showTotal。
  showTotal: (count) => `共 ${count} 条`,
}))

/** 勾选配置 */
const rowSelection = computed(() => ({
  selectedRowKeys: selectedKeys.value,
  columnWidth: SELECTION_WIDTH,
  onChange: (keys) => {
    selectedKeys.value = keys
  },
}))

/**
 * 点「查询」—— 把填的条件变成生效的条件,回到第一页重查
 *
 * <p>⚠️ **必须回到第一页**:停在第 5 页再查,新条件下的第 5 页多半是空的 ——
 *    用户会以为「查出来没有结果」,其实是翻到了老地方。
 *
 * <p>⚠️ **勾选也清掉**:上一页勾的行在新条件下可能压根不在列表里。
 */
const applyQuery = async () => {
  // ⚠️ 日期范围可能是 null(清空过)—— 硬解构会抛 TypeError,
  //    整个处理函数就断在那儿,按钮点了跟没点一样。
  const range = Array.isArray(form.dateRange) ? form.dateRange : []
  applied.fileName = (form.fileName || '').trim()
  applied.dateRange = range.length === 2 ? [range[0], range[1]] : null
  applied.status = form.status
  current.value = 1
  selectedKeys.value = []
  await loadFiles()
}

/**
 * 点「重置」—— 条件全清(表单 + 生效的那份),回到第一页重查
 */
const resetQuery = async () => {
  form.fileName = ''
  form.dateRange = null
  form.status = -1
  applied.fileName = ''
  applied.dateRange = null
  applied.status = -1
  current.value = 1
  selectedKeys.value = []
  await loadFiles()
}

/**
 * 拉列表
 *
 * @param {object} [params]
 * @param {boolean} [params.silent] 后台悄悄刷新(不转圈)——
 *        处理中的文件状态在变,每 3 秒刷一次,每次都让表格转一下太吵
 */
const loadFiles = async ({ silent = false } = {}) => {
  if (!silent) loading.value = true
  try {
    const data = await customerServiceApi.listFiles({
      current: current.value,
      size: pageSize.value,
      // ⚠️ 条件只认**生效的那份**(applied)—— 用户填了还没点查询的不算
      // -1 = 全部 → 不传这个参数(后端把 null 当「不过滤」)
      status: applied.status >= 0 ? applied.status : undefined,
      fileName: applied.fileName || undefined,
      startDate: applied.dateRange?.[0],
      endDate: applied.dateRange?.[1],
    })
    files.value = data.items
    total.value = data.total
    // ⚠️ 用后端回的页号:它可能把越界的页号拉回最后一页
    current.value = data.current
  } catch (e) {
    showFeedback('error', describeError(e, '文件列表加载失败'))
    files.value = []
    total.value = 0
  } finally {
    if (!silent) loading.value = false
    scheduleAutoRefresh()
  }
}

/**
 * 处理中的文件自动刷新
 *
 * <p>⚠️ 上传只是落库,切分 + 向量化是后台线程干的活(几秒到几分钟)——
 *    用户盯着「待处理」不动会以为坏了。这里每隔几秒悄悄刷一次列表,
 *    状态一变就看见了。
 *
 * <p>没有文件在处理中就不刷了(省得空转)。
 */
let refreshTimer = null

const clearAutoRefresh = () => {
  if (refreshTimer) {
    clearTimeout(refreshTimer)
    refreshTimer = null
  }
}

const scheduleAutoRefresh = () => {
  clearAutoRefresh()
  // ⚠️ 抽屉关了就不刷了 —— 用户看不见,还在跑纯属浪费
  //    (关的动作可能在请求还在飞的时候发生,这时候 finally 里还会走到这儿)
  if (!props.open) return
  if (!files.value.some((f) => isProcessing(f))) return
  refreshTimer = setTimeout(async () => {
    await loadFiles({ silent: true })
  }, 3000)
}

/**
 * 表格翻页 / 改每页条数
 *
 * @param {object} page antd 给的分页对象(current / pageSize)
 */
const handleTableChange = (page) => {
  const nextCurrent = page.current ?? current.value
  const nextSize = page.pageSize ?? pageSize.value
  if (nextSize !== pageSize.value) {
    // ⚠️ 改了每页条数就回到第一页:停在第 5 页、每页从 10 变 50 的话,
    //    第 5 页可能早就不存在了(总共才两页)
    pageSize.value = nextSize
    current.value = 1
  } else {
    current.value = nextCurrent
  }
  // ⚠️ 换页了,勾选也清掉 —— 上一页勾的行在这一页根本不存在
  selectedKeys.value = []
  loadFiles()
}

/**
 * 上传前的检查
 *
 * <p>⚠️ 这道检查是**为了让用户少白跑一趟**:后端也会拒(只认 .md、10MB 上限),
 *    但那时文件已经选完了还得重新选。
 *
 * @returns {boolean} false = 不上传
 */
const beforeUpload = (file) => {
  const name = file?.name || ''
  if (!name.toLowerCase().endsWith('.md')) {
    showFeedback('error', '只支持 Markdown 文件(.md 后缀)')
    return false
  }
  if (file.size > customerServiceApi.MAX_UPLOAD_SIZE) {
    showFeedback('error', '文件超过 10MB 上限')
    return false
  }
  return true
}

/**
 * 真的上传
 *
 * <p>antd 的 Upload 默认自己发请求,但后端要的是 multipart 且字段名固定为 {@code file} ——
 *    用 {@code customRequest} 自己发,顺带把「上传中」和失败原因都接住。
 */
const doUpload = async ({ file, onSuccess, onError }) => {
  uploading.value = true
  try {
    const data = await customerServiceApi.uploadFile(file)
    onSuccess?.(data)
    const name = data.originalFileName || file.name
    // ⚠️ **筛选着的时候,新文件可能压根不在列表里** ——
    //    说清楚,不然用户传完了在列表里翻不到,会以为没传上去。
    showFeedback(
      'success',
      `「${name}」已上传,正在切分并向量化${hasActiveQuery.value ? '(当前有筛选条件,列表里可能看不到它)' : ''}`,
      { autoClose: true }
    )
    // 新文件在第一页 —— 回第一页才看得见它
    current.value = 1
    await loadFiles()
  } catch (e) {
    onError?.(e)
    showFeedback('error', describeError(e, '上传失败'))
  } finally {
    uploading.value = false
  }
}

/* ──────────────────────────────────────────────────────────────────────
 * 详情抽屉
 *
 * ⚠️ **失败原因只在这儿出现**:表格单元格里放不下长文本
 *    (一行能把整张表撑变形,而且悬停才看得到 ≈ 没有)。
 * ────────────────────────────────────────────────────────────────────── */

/** 详情抽屉是否打开 */
const detailOpen = ref(false)
/** 正在看的那个文件 */
const detailFile = ref(null)
/**
 * 抽屉看的是哪种详情
 *
 * <p>full = 全部详情;error = 只看失败原因(那一段常常很长,单独占一页才看得全)。
 */
const detailMode = ref('full')

/**
 * 详情抽屉里显示的那条
 *
 * <p>列表刷新过之后,还在列表里的就显示最新的那份(状态可能变了),
 *    已经不在了就用点开时的那份快照。
 */
const detail = computed(() => {
  const file = detailFile.value
  if (!file) return null
  return files.value.find((f) => f.id === file.id) || file
})

/**
 * 打开详情
 *
 * @param {object} record 哪一行
 * @param {'full'|'error'} mode 看全部详情,还是只看失败原因
 */
const openDetail = (record, mode = 'full') => {
  detailFile.value = record
  detailMode.value = mode
  detailOpen.value = true
}

/**
 * 复制文件名
 *
 * <p>⚠️ 复制成功也要给个反馈 —— 用户点了没反应,会以为按钮坏了。
 * <p>⚠️ 反馈显示在**详情抽屉里**(不是列表抽屉那条反馈条):
 *    详情抽屉正盖着列表抽屉,提示写在那边等于没写。
 */
const copyState = ref(null)
/** 复制提示的自动消失定时器 */
let copyTimer = null

const copyName = async (record) => {
  const ok = await copyText(record.originalFileName)
  copyState.value = ok
    ? { type: 'success', text: '已复制' }
    : { type: 'error', text: '复制失败,手动选中复制也行' }
  clearTimeout(copyTimer)
  copyTimer = setTimeout(() => {
    copyState.value = null
  }, 2500)
}

/** 改备注 */
const remarkOpen = ref(false)
/** 正在改哪个文件 */
const remarkTarget = ref(null)
/** 备注内容 */
const remarkText = ref('')
/** 正在保存 */
const remarkSaving = ref(false)

const openRemark = (record) => {
  remarkTarget.value = record
  remarkText.value = record.remark || ''
  remarkOpen.value = true
}

const saveRemark = async () => {
  const target = remarkTarget.value
  if (!target) return
  // ⚠️ 后端的备注列是 varchar(200),超了会报 500(不是 400)—— 前端先拦一道
  if (remarkText.value.length > 200) {
    showFeedback('error', '备注最长 200 字')
    return
  }
  remarkSaving.value = true
  try {
    await customerServiceApi.updateRemark({ id: target.id, remark: remarkText.value.trim() })
    remarkOpen.value = false
    showFeedback('success', '备注已保存', { autoClose: true })
    await loadFiles({ silent: true })
  } catch (e) {
    showFeedback('error', describeError(e, '备注保存失败'))
  } finally {
    remarkSaving.value = false
  }
}

/**
 * 删掉一个文件
 *
 * <p>⚠️ 删掉的是本页的最后一条时,得往前翻一页 ——
 *    留在一个已经不存在的页码上,表格会空着(后端会把越界的页号拉回去,
 *    但页码显示会和内容对不上)。
 */
const doDelete = async (record) => {
  if (deleting.has(record.id)) return
  deleting.add(record.id)
  try {
    await customerServiceApi.deleteFile({ id: record.id })
    showFeedback('success', `「${record.originalFileName}」已删除`, { autoClose: true })
    if (files.value.length === 1 && current.value > 1) current.value -= 1
    selectedKeys.value = selectedKeys.value.filter((id) => id !== record.id)
    await loadFiles()
  } catch (e) {
    showFeedback('error', describeError(e, '删除失败'))
  } finally {
    deleting.delete(record.id)
  }
}

/**
 * 批量删除选中的文件
 *
 * <p>⚠️ 后端**没有**批量删除的接口,只能一个个删 ——
 *    所以这里自己循环,并把结果说清楚:
 *    删掉几个、失败几个、失败的为什么失败、处理中的那几个没删(后端不让删)。
 */
const doBatchDelete = async () => {
  const targets = files.value.filter((f) => selectedKeys.value.includes(f.id))
  if (!targets.length) return

  // 处理中的文件后端不让删 —— 提前剔掉,别让用户白等一轮报错
  const processing = targets.filter((f) => isProcessing(f))
  const deletable = targets.filter((f) => !isProcessing(f))

  if (!deletable.length) {
    showFeedback('error', '选中的文件都在处理中,等处理结束后才能删除')
    return
  }

  const results = await Promise.allSettled(
    deletable.map((f) => customerServiceApi.deleteFile({ id: f.id }))
  )
  const failed = results
    .map((r, i) => (r.status === 'rejected' ? deletable[i] : null))
    .filter(Boolean)

  selectedKeys.value = []
  await loadFiles()

  if (!failed.length) {
    showFeedback(
      'success',
      `已删除 ${deletable.length} 个文件${processing.length ? `,${processing.length} 个还在处理中没删` : ''}`,
      { autoClose: true }
    )
    return
  }
  const reason = failed[0]?.originalFileName || '某个文件'
  showFeedback(
    'error',
    `删掉了 ${deletable.length - failed.length} 个,${failed.length} 个没删掉(比如「${reason}」)`
  )
}

/** 打开抽屉 → 拉一次列表 */
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      // 重新打开时清掉上次的反馈(免得一句老提示杵在那儿)
      clearFeedback()
      selectedKeys.value = []
      loadFiles()
    } else {
      // 关了就不刷了 —— 后台刷新看不见,还在跑纯属浪费
      clearAutoRefresh()
      detailOpen.value = false
    }
  }
)

/**
 * 两个抽屉各自的伸缩把手
 *
 * <p>⚠️ <b>不能在模板里直接把 {@code listWidth} 传给函数</b>:
 *    模板里的 ref 是**自动解包**的,传进去的是数字不是 ref,
 *    函数里改 {@code widthRef.value} 就成了给数字加属性 —— 静默地什么也没发生。
 *    所以这里用两个包装函数,把 ref 抓住。
 */
const startListResize = (event) => startDrawerResize(event, listWidth)
const startDetailResize = (event) => startDrawerResize(event, detailWidth)

/** 关闭 */
const close = () => emit('update:open', false)

// 一进来就把记住的列宽套上
restoreColumnWidths()

onBeforeUnmount(() => {
  clearAutoRefresh()
  clearTimeout(feedbackTimer)
  clearTimeout(copyTimer)
})
</script>

<style scoped>
/* 表头:标题 + 右边一条可拖的竖线 */
.col-head {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
}

/*
 * 拖拽把手。
 * ⚠️ 往右挪出一点(跨过单元格的 padding),让把手正好落在单元格的分隔线上 ——
 *    否则它缩在文字旁边,用户根本不知道那儿能拖。
 */
.col-resizer {
  position: absolute;
  right: -8px;
  top: -8px;
  bottom: -8px;
  width: 8px;
  cursor: col-resize;
  user-select: none;
  touch-action: none;
}

.col-resizer:hover {
  background: rgba(77, 107, 254, 0.35);
}

/* 状态标签:做成可点的(点它看失败原因) */
.status-btn {
  border: 0;
  background: none;
  padding: 0;
  margin: 0;
  cursor: pointer;
  line-height: 1;
}

/* 文件名:做成可点的(点它看全部详情) */
.name-btn {
  border: 0;
  background: none;
  padding: 0;
  margin: 0;
  cursor: pointer;
  text-align: left;
  color: inherit;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
}

.name-btn:hover {
  color: #4d6bfe;
  text-decoration: underline;
}

/*
 * 抽屉左边那条伸缩线。
 * ⚠️ 绝对定位 + left 为负 —— 它的定位参照系是抽屉面板
 *    (antd 的 .ant-drawer-content-wrapper 是 absolute),所以这条线正好骑在抽屉的左边缘上。
 */
.drawer-resizer {
  position: absolute;
  left: -4px;
  top: 0;
  bottom: 0;
  width: 8px;
  cursor: col-resize;
  user-select: none;
  touch-action: none;
  z-index: 5;
}

.drawer-resizer:hover {
  background: rgba(77, 107, 254, 0.25);
}
</style>
